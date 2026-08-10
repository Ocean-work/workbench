# -*- coding: utf-8 -*-
"""
文档自检引擎（浏览器端 Pyodide 版本）
接收 docx 文件二进制数据和规则 JSON，返回检查结果 JSON
"""
import sys
import io
import re
import json
from collections import defaultdict, Counter
from datetime import datetime

try:
    from docx import Document
    from docx.shared import Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH
except ImportError:
    Document = None

try:
    from lxml import etree
except ImportError:
    etree = None

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

ALIGN_MAP = {
    WD_ALIGN_PARAGRAPH.LEFT: '左对齐' if WD_ALIGN_PARAGRAPH else '左对齐',
    WD_ALIGN_PARAGRAPH.CENTER: '居中对齐' if WD_ALIGN_PARAGRAPH else '居中对齐',
    WD_ALIGN_PARAGRAPH.RIGHT: '右对齐' if WD_ALIGN_PARAGRAPH else '右对齐',
    WD_ALIGN_PARAGRAPH.JUSTIFY: '两端对齐' if WD_ALIGN_PARAGRAPH else '两端对齐',
    None: '未设置',
}


def pt_to_cn_size(pt_val):
    cn_sizes = {
        42: '初号', 36: '小初', 26: '一号', 24: '小一',
        22: '二号', 18: '小二', 16: '三号', 15: '小三',
        14: '四号', 12: '小四', 10.5: '五号', 9: '小五',
        7.5: '六号', 6.5: '小六', 5: '七号', 3.5: '八号',
    }
    for pt, name in sorted(cn_sizes.items(), key=lambda x: -x[0]):
        if abs(pt_val - pt) < 0.5:
            return name
    return f'{pt_val}pt'

def pt_str(val):
    if val is None:
        return None
    try:
        return pt_to_cn_size(val.pt)
    except:
        return str(val)

def cm_to_chars(cm_val):
    if cm_val is None:
        return None
    raw = cm_val / 0.42
    chars = round(raw)
    if abs(raw - chars) > 0.3:
        chars_r = round(raw, 1)
        if chars_r == int(chars_r):
            return f'{int(chars_r)}字符'
        return f'{chars_r}字符'
    return f'{chars}字符'

def line_spacing_val(spacing):
    if spacing is None or spacing.line_spacing is None:
        return None
    val = spacing.line_spacing
    if val >= 240:
        multiple = val / 240
        if multiple == int(multiple):
            return f'{int(multiple)}倍行距'
        return f'{multiple:.2f}倍行距'
    return pt_str(val)


def extract_run_format(run):
    font = run.font
    info = {}
    rPr = run._element.find(f'{W}rPr')
    ea_font = ascii_font = None
    if rPr is not None:
        ea = rPr.find(f'{W}rFonts')
        if ea is not None:
            ea_font = ea.get(f'{W}eastAsia')
            ascii_font = ea.get(f'{W}ascii')
    fonts = []
    if ascii_font:
        fonts.append(f'西文:{ascii_font}')
    if ea_font:
        fonts.append(f'中文:{ea_font}')
    if not fonts and font.name:
        fonts.append(font.name)
    if fonts:
        info['字体'] = ', '.join(fonts)

    sz = font.size
    if sz:
        info['字号'] = pt_str(sz)
    if not sz and rPr is not None:
        sz_el = rPr.find(f'{W}sz')
        if sz_el is not None:
            sz_val = sz_el.get(f'{W}val')
            if sz_val:
                pt_v = int(sz_val) / 2
                info['字号'] = pt_to_cn_size(pt_v)

    if font.bold:
        info['加粗'] = True
    if font.italic:
        info['斜体'] = True
    if font.underline:
        info['下划线'] = True
    if font.color and font.color.rgb:
        info['颜色'] = f'#{font.color.rgb}'
    return info


def extract_para_format(para):
    pf = para.paragraph_format
    info = {}
    align_text = ALIGN_MAP.get(para.alignment)
    if align_text and align_text != '未设置':
        info['对齐'] = align_text
    ls = line_spacing_val(pf)
    if ls:
        info['行距'] = ls
    if pf.space_before:
        info['段前'] = pt_str(pf.space_before)
    if pf.space_after:
        info['段后'] = pt_str(pf.space_after)
    if pf.first_line_indent:
        try:
            cm_val = pf.first_line_indent / 914400 * 2.54
            info['首行缩进'] = cm_to_chars(cm_val)
        except:
            pass
    pPr2 = para._element.find(f'{W}pPr')
    if pPr2 is not None:
        ind = pPr2.find(f'{W}ind')
        if ind is not None:
            flc = ind.get(f'{W}firstLineChars')
            if flc and '首行缩进' not in info:
                chars = int(flc) / 100
                if chars == int(chars):
                    info['首行缩进'] = f'{int(chars)}字符'
                else:
                    info['首行缩进'] = f'{chars}字符'
    return info


def check_document_bytes(docx_bytes, rules_json, filename='document.docx'):
    """
    检查文档（Pyodide浏览器端主入口）
    
    Args:
        docx_bytes: bytes, docx文件二进制数据
        rules_json: dict, 规则库JSON（从rules.json加载）
        filename: str, 文件名（用于展示）
    
    Returns:
        dict: 检查结果，格式与前端 CheckResult 对齐
    """
    if Document is None:
        return {'error': 'python-docx not available'}
    
    doc = Document(io.BytesIO(docx_bytes))
    rules = rules_json
    
    format_issues = []
    content_issues = []
    logic_issues = []
    
    # ---- 格式检查 ----
    body_rules = rules.get('body', {})
    heading_rules = rules.get('headings', {})

    for i, para in enumerate(doc.paragraphs):
        text = para.text.strip()
        if not text:
            continue

        display_text = text[:30] + '...' if len(text) > 30 else text
        location = f'{filename} · 第{i+1}段'
        style_name = para.style.name if para.style else 'Normal'
        is_heading = style_name.startswith('Heading') or style_name.startswith('标题')

        para_fmt = extract_para_format(para)
        run_fmts = [extract_run_format(r) for r in para.runs if r.text.strip()]

        if is_heading and style_name in heading_rules:
            hr = heading_rules[style_name]
            if hr.get('字体'):
                for rf in run_fmts:
                    actual_font = rf.get('字体', '')
                    if hr['字体'] not in actual_font:
                        format_issues.append({
                            'id': f'fmt-h-{i}-font',
                            'category': '格式-标题字体',
                            'description': f'标题「{display_text}」字体不符合规范：应为「{hr["字体"]}」，当前为「{actual_font}」',
                            'location': location,
                            'severity': 'error'
                        })
            if hr.get('字号'):
                for rf in run_fmts:
                    actual_size = rf.get('字号', '')
                    if hr['字号'] != actual_size and actual_size:
                        format_issues.append({
                            'id': f'fmt-h-{i}-size',
                            'category': '格式-标题字号',
                            'description': f'标题「{display_text}」字号不符合规范：应为「{hr["字号"]}」，当前为「{actual_size}」',
                            'location': location,
                            'severity': 'error'
                        })
        elif not is_heading:
            if body_rules.get('字体'):
                for rf in run_fmts:
                    actual_font = rf.get('字体', '')
                    if body_rules['字体'] not in actual_font:
                        format_issues.append({
                            'id': f'fmt-b-{i}-font',
                            'category': '格式-正文字体',
                            'description': f'正文字体不符合规范：应为「{body_rules["字体"]}」，当前为「{actual_font}」',
                            'location': location,
                            'severity': 'warning'
                        })
                        break  # 每段只报一次
            if body_rules.get('字号'):
                has_issue = False
                for rf in run_fmts:
                    actual_size = rf.get('字号', '')
                    if body_rules['字号'] != actual_size and actual_size:
                        has_issue = True
                        break
                if has_issue:
                    format_issues.append({
                        'id': f'fmt-b-{i}-size',
                        'category': '格式-正文字号',
                        'description': f'正文字号不符合规范：应为「{body_rules["字号"]}」，当前段落存在不一致字号',
                        'location': location,
                        'severity': 'warning'
                    })
            if body_rules.get('首行缩进'):
                actual_indent = para_fmt.get('首行缩进')
                if not actual_indent:
                    format_issues.append({
                        'id': f'fmt-b-{i}-indent',
                        'category': '格式-首行缩进',
                        'description': f'正文缺少首行缩进，规范要求为「{body_rules["首行缩进"]}」',
                        'location': location,
                        'severity': 'warning'
                    })
                elif body_rules['首行缩进'] != actual_indent:
                    format_issues.append({
                        'id': f'fmt-b-{i}-indent',
                        'category': '格式-首行缩进',
                        'description': f'首行缩进不符合规范：应为「{body_rules["首行缩进"]}」，当前为「{actual_indent}」',
                        'location': location,
                        'severity': 'warning'
                    })

    # 表格格式检查
    table_rules = rules.get('tables', [])
    for t_idx, table in enumerate(doc.tables):
        if t_idx >= len(table_rules):
            continue
        tr = table_rules[t_idx]
        for r_idx, row in enumerate(table.rows):
            for c_idx, cell in enumerate(row.cells):
                cell_text = cell.text.strip()
                if not cell_text:
                    continue
                location = f'{filename} · 表格{t_idx+1}[{r_idx+1},{c_idx+1}]'
                found_font_issue = False
                found_size_issue = False
                for para in cell.paragraphs:
                    for run in para.runs:
                        if run.text.strip():
                            rf = extract_run_format(run)
                            if tr.get('字体') and rf.get('字体') and not found_font_issue:
                                if tr['字体'] not in rf['字体']:
                                    format_issues.append({
                                        'id': f'fmt-t-{t_idx}-{r_idx}-{c_idx}-font',
                                        'category': '格式-表格字体',
                                        'description': f'表格单元格字体不符合规范：应为「{tr["字体"]}」，当前为「{rf["字体"]}」',
                                        'location': location,
                                        'severity': 'warning'
                                    })
                                    found_font_issue = True
                            if tr.get('字号') and rf.get('字号') and not found_size_issue:
                                if tr['字号'] != rf['字号']:
                                    format_issues.append({
                                        'id': f'fmt-t-{t_idx}-{r_idx}-{c_idx}-size',
                                        'category': '格式-表格字号',
                                        'description': f'表格单元格字号不符合规范：应为「{tr["字号"]}」，当前为「{rf["字号"]}」',
                                        'location': location,
                                        'severity': 'warning'
                                    })
                                    found_size_issue = True

    # ---- 内容检查 ----
    all_text_list = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            all_text_list.append(text)
    full_text = '\n'.join(all_text_list)

    # 占位符检查
    placeholder_patterns = [
        r'（请填写）', r'\(请填写\)', r'（待填写）', r'\(待填写\)',
        r'（此处填写', r'（请补充', r'______',
        r'【请填写】', r'〖请填写〗',
    ]
    for i, para in enumerate(doc.paragraphs):
        text = para.text.strip()
        for pattern in placeholder_patterns:
            if re.search(pattern, text):
                location = f'{filename} · 第{i+1}段'
                content_issues.append({
                    'id': f'cnt-ph-{i}',
                    'category': '内容-占位符',
                    'description': f'存在未填写的占位符内容：「{text[:30]}」',
                    'location': location,
                    'severity': 'error'
                })
                break

    # 基础信息一致性
    base_info = rules.get('base_info', [])
    if base_info:
        for bi in base_info:
            expected_text = bi['text']
            count_in_template = bi['count']
            actual_count = full_text.count(expected_text)
            if actual_count == 0:
                content_issues.append({
                    'id': f'cnt-bi-{bi["text"][:10]}',
                    'category': '内容-基础信息',
                    'description': f'模板中的基础信息「{expected_text}」在文档中未找到（可能遗漏或被修改）',
                    'location': f'{filename} · 全文',
                    'severity': 'warning'
                })

    # 空表格单元格
    for t_idx, table in enumerate(doc.tables):
        for r_idx, row in enumerate(table.rows):
            for c_idx, cell in enumerate(row.cells):
                if not cell.text.strip():
                    content_issues.append({
                        'id': f'cnt-tc-{t_idx}-{r_idx}-{c_idx}',
                        'category': '内容-空单元格',
                        'description': '表格单元格为空，可能需要填写内容',
                        'location': f'{filename} · 表格{t_idx+1}[{r_idx+1},{c_idx+1}]',
                        'severity': 'info'
                    })

    # ---- 逻辑检查 ----
    headings_with_pos = []
    for i, para in enumerate(doc.paragraphs):
        text = para.text.strip()
        if text:
            style_name = para.style.name if para.style else 'Normal'
            is_heading = style_name.startswith('Heading') or style_name.startswith('标题')
            if is_heading:
                headings_with_pos.append((i, text, style_name))

    # 标题编号连续性
    for i in range(1, len(headings_with_pos)):
        _, prev_text, prev_style = headings_with_pos[i-1]
        _, curr_text, curr_style = headings_with_pos[i]
        if prev_style == curr_style:
            prev_num = re.match(r'^(\d+)[\.、．]', prev_text)
            curr_num = re.match(r'^(\d+)[\.、．]', curr_text)
            if prev_num and curr_num:
                if int(curr_num.group(1)) != int(prev_num.group(1)) + 1:
                    logic_issues.append({
                        'id': f'log-hn-{i}',
                        'category': '逻辑-标题编号',
                        'description': f'标题编号不连续：前一个为第{prev_num.group(1)}，当前为第{curr_num.group(1)}',
                        'location': f'{filename} · 标题「{curr_text[:30]}」',
                        'severity': 'error'
                    })

    # 总字数检查
    total_chars = len(full_text)
    if total_chars < 100:
        logic_issues.append({
            'id': 'log-tc-1',
            'category': '逻辑-内容完整性',
            'description': f'文档内容过少（仅{total_chars}字），可能不完整',
            'location': f'{filename} · 全文',
            'severity': 'warning'
        })

    # 统计
    error_count = sum(1 for i in format_issues if i['severity'] == 'error') + \
                  sum(1 for i in content_issues if i['severity'] == 'error') + \
                  sum(1 for i in logic_issues if i['severity'] == 'error')
    warning_count = sum(1 for i in format_issues if i['severity'] == 'warning') + \
                    sum(1 for i in content_issues if i['severity'] == 'warning') + \
                    sum(1 for i in logic_issues if i['severity'] == 'warning')
    info_count = sum(1 for i in format_issues if i['severity'] == 'info') + \
                 sum(1 for i in content_issues if i['severity'] == 'info') + \
                 sum(1 for i in logic_issues if i['severity'] == 'info')

    return {
        'filename': filename,
        'total_paragraphs': len(doc.paragraphs),
        'total_tables': len(doc.tables),
        'total_chars': total_chars,
        'format_issues': format_issues,
        'content_issues': content_issues,
        'logic_issues': logic_issues,
        'errors': error_count,
        'warnings': warning_count,
        'info': info_count,
    }


def generate_annotated_docx(docx_bytes, check_result):
    """
    生成带批注的 docx 文件
    返回 bytes
    
    注意：浏览器端 lxml 可能不可用，如果不可用则返回原始 bytes
    """
    import zipfile
    
    if etree is None:
        return docx_bytes
    
    W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
    REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
    
    # 收集段落问题
    para_issues = defaultdict(list)
    all_issues = check_result['format_issues'] + check_result['content_issues'] + check_result['logic_issues']
    
    for issue in all_issues:
        match = re.search(r'第(\d+)段', issue.get('location', ''))
        if match:
            para_idx = int(match.group(1)) - 1
            para_issues[para_idx].append(issue)
    
    if not para_issues:
        return docx_bytes
    
    comments = []
    comment_id = 0
    
    input_buf = io.BytesIO(docx_bytes)
    output_buf = io.BytesIO()
    
    with zipfile.ZipFile(input_buf, 'r') as zin:
        with zipfile.ZipFile(output_buf, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                
                if item.filename == 'word/document.xml':
                    root = etree.fromstring(data)
                    body = root.find(f'{{{W_NS}}}body')
                    paragraphs = body.findall(f'{{{W_NS}}}p')
                    
                    for para_idx, issues in para_issues.items():
                        if para_idx >= len(paragraphs):
                            continue
                        para = paragraphs[para_idx]
                        
                        severity_icons = {'error': '❌', 'warning': '⚠️', 'info': 'ℹ️'}
                        text_parts = ['[自检问题]']
                        for issue in issues:
                            icon = severity_icons.get(issue.get('severity', 'info'), 'ℹ️')
                            text_parts.append(f'{icon} {issue["description"][:80]}')
                        comment_text = '\n'.join(text_parts)
                        
                        cid = comment_id
                        comment_id += 1
                        comments.append({
                            'id': cid,
                            'author': '文档自检工具',
                            'date': datetime.now().strftime('%Y-%m-%dT%H:%M:%S') + 'Z',
                            'text': comment_text,
                        })
                        
                        runs = para.findall(f'{{{W_NS}}}r')
                        crs = etree.SubElement(para, f'{{{W_NS}}}commentRangeStart')
                        crs.set(f'{{{W_NS}}}id', str(cid))
                        if runs:
                            para.remove(crs)
                            runs[0].addprevious(crs)
                        
                        cre = etree.SubElement(para, f'{{{W_NS}}}commentRangeEnd')
                        cre.set(f'{{{W_NS}}}id', str(cid))
                        
                        ref_run = etree.SubElement(para, f'{{{W_NS}}}r')
                        ref_rPr = etree.SubElement(ref_run, f'{{{W_NS}}}rPr')
                        rStyle = etree.SubElement(ref_rPr, f'{{{W_NS}}}rStyle')
                        rStyle.set(f'{{{W_NS}}}val', 'CommentReference')
                        cr = etree.SubElement(ref_run, f'{{{W_NS}}}commentReference')
                        cr.set(f'{{{W_NS}}}id', str(cid))
                    
                    data = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
                    zout.writestr(item, data)
                
                elif item.filename == '[Content_Types].xml':
                    root = etree.fromstring(data)
                    has_comments = any('comments.xml' in el.get('PartName', '') for el in root)
                    if not has_comments and comments:
                        override = etree.SubElement(root, f'{{{CT_NS}}}Override')
                        override.set('PartName', '/word/comments.xml')
                        override.set('ContentType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml')
                    data = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
                    zout.writestr(item, data)
                
                elif item.filename == 'word/_rels/document.xml.rels':
                    root = etree.fromstring(data)
                    has_comments = any('comments.xml' in rel.get('Target', '') for rel in root)
                    if not has_comments and comments:
                        max_rid = 0
                        for rel in root:
                            m = re.search(r'rId(\d+)', rel.get('Id', ''))
                            if m:
                                max_rid = max(max_rid, int(m.group(1)))
                        new_rel = etree.SubElement(root, f'{{{REL_NS}}}Relationship')
                        new_rel.set('Id', f'rId{max_rid + 1}')
                        new_rel.set('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments')
                        new_rel.set('Target', 'comments.xml')
                    data = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
                    zout.writestr(item, data)
                
                else:
                    zout.writestr(item, data)
            
            # 写入 comments.xml
            if comments:
                comments_root = etree.Element(f'{{{W_NS}}}comments')
                for c in comments:
                    comment_el = etree.SubElement(comments_root, f'{{{W_NS}}}comment')
                    comment_el.set(f'{{{W_NS}}}id', str(c['id']))
                    comment_el.set(f'{{{W_NS}}}author', c['author'])
                    comment_el.set(f'{{{W_NS}}}date', c['date'])
                    comment_el.set(f'{{{W_NS}}}initials', 'SC')
                    for line in c['text'].split('\n'):
                        p = etree.SubElement(comment_el, f'{{{W_NS}}}p')
                        r = etree.SubElement(p, f'{{{W_NS}}}r')
                        t = etree.SubElement(r, f'{{{W_NS}}}t')
                        t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
                        t.text = line
                comments_xml = etree.tostring(comments_root, xml_declaration=True, encoding='UTF-8', standalone=True)
                zout.writestr('word/comments.xml', comments_xml)
    
    return output_buf.getvalue()


def batch_check(files_data, rules_map, course_name, grade):
    """
    批量检查多个文档 + 跨文档一致性
    
    Args:
        files_data: list of {filename: str, bytes: bytes}
        rules_map: dict, {rule_key: rules_json} 规则库集合
        course_name: str, 课程名称
        grade: str, 年级
    
    Returns:
        dict: 综合检查结果
    """
    per_file_results = {}
    
    # 确定每个文件用哪个规则库（根据文件名匹配）
    def match_rules(filename):
        fname_lower = filename.lower()
        if '教案' in filename or 'jiaoan' in fname_lower:
            if '封皮' in filename or '封面' in filename:
                return '教案封皮'
            return '教案内页'
        if '授课计划' in filename:
            return '授课计划'
        if '教学进度' in filename or '进度表' in filename:
            return '教学进度表'
        if '考核' in filename:
            return '考核方案'
        if '评分' in filename or '细则' in filename:
            return '评分细则'
        if '实验' in filename and '指导' in filename:
            return '实验指导书'
        if '试卷' in filename:
            return '试卷'
        # 默认使用理论实验通用规则
        return '理论实验'
    
    # 逐个文件检查
    for fd in files_data:
        fname = fd['filename']
        fbytes = fd['bytes']
        rule_key = match_rules(fname)
        rules = rules_map.get(rule_key, rules_map.get('理论实验', {}))
        
        if rules:
            result = check_document_bytes(fbytes, rules, fname)
        else:
            result = {
                'filename': fname,
                'format_issues': [],
                'content_issues': [],
                'logic_issues': [],
                'errors': 0,
                'warnings': 0,
                'info': 0,
                'note': '未找到匹配规则库'
            }
        
        per_file_results[fname] = result
    
    # 跨文件一致性检查（简化版）
    consistency_issues = []
    course_matches = []
    to_confirm_items = []
    
    if len(files_data) >= 2:
        # 提取各文件的关键信息进行对比
        file_infos = {}
        for fname, result in per_file_results.items():
            # 简单从文件名识别文件类型
            info = {'filename': fname}
            file_infos[fname] = info
        
        # 课程名称匹配检查
        course_matches.append({
            'id': 'cm-course',
            'category': '课程-定位',
            'description': f'已识别课程「{course_name}」（{grade}级），共{len(files_data)}个文件参与检查',
            'location': f'{grade}级课程档案'
        })
        
        # 跨文件一致性提示
        if len(files_data) >= 3:
            consistency_issues.append({
                'id': 'ci-files-count',
                'category': '内容-文件完整性',
                'description': f'已上传{len(files_data)}个文件，请核对是否包含所有必备文件（大纲、授课计划、进度表等）',
                'location': '全部文件'
            })
        
        # 待确认项
        to_confirm_items.append({
            'id': 'tc-1',
            'category': '内容-人工确认',
            'description': f'{course_name}课程的学时分配是否符合培养方案要求？建议人工核对',
            'location': '培养方案对照'
        })
    
    # 汇总
    total_format_issues = []
    total_errors = 0
    total_warnings = 0
    total_to_confirm = len(to_confirm_items)
    
    for fname, result in per_file_results.items():
        # 格式问题汇总到 formatIssues
        for issue in result.get('format_issues', []):
            total_format_issues.append(issue)
        for issue in result.get('content_issues', []):
            total_format_issues.append(issue)  # 内容问题也放格式Tab
        total_errors += result.get('errors', 0)
        total_warnings += result.get('warnings', 0) + result.get('info', 0)
    
    # 生成批注版文档列表
    annotated_files = []
    for fd in files_data:
        fname = fd['filename']
        result = per_file_results.get(fname, {})
        try:
            annotated_bytes = generate_annotated_docx(fd['bytes'], result)
            base_name = fname.rsplit('.', 1)[0] if '.' in fname else fname
            annotated_files.append({
                'filename': f'{base_name}_批注版.docx',
                'bytes': annotated_bytes
            })
        except Exception as e:
            # 批注生成失败，用原始文件
            annotated_files.append({
                'filename': fname,
                'bytes': fd['bytes']
            })
    
    return {
        'totalFiles': len(files_data),
        'errors': total_errors,
        'warnings': total_warnings,
        'toConfirm': total_to_confirm,
        'consistencyIssues': consistency_issues,
        'courseMatches': course_matches,
        'formatIssues': total_format_issues,
        'toConfirmItems': to_confirm_items,
        'perFileResults': per_file_results,
        'annotatedFiles': annotated_files,
    }


# 入口函数：供 JS 调用
def run_check(files_json, rules_json, course_name, grade):
    """
    JS 调用的主入口
    
    Args:
        files_json: list of dicts with 'filename' and 'bytes_base64' (base64 encoded)
        rules_json: dict of rule_name -> rules dict
        course_name: str
        grade: str
    
    Returns:
        dict with check results
    """
    import base64
    
    files_data = []
    for f in files_json:
        fbytes = base64.b64decode(f['bytes_base64'])
        files_data.append({
            'filename': f['filename'],
            'bytes': fbytes
        })
    
    result = batch_check(files_data, rules_json, course_name, grade)
    
    # 将批注文件转为 base64 传回
    annotated_base64 = []
    for af in result.get('annotatedFiles', []):
        annotated_base64.append({
            'filename': af['filename'],
            'bytes_base64': base64.b64encode(af['bytes']).decode('ascii')
        })
    result['annotatedFiles'] = annotated_base64
    
    # perFileResults 不需要传回 bytes，删掉
    result.pop('perFileResults', None)
    
    return result
