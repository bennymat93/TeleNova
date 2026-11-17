# -*- coding: utf-8 -*-
"""4.2.7: scan skin XML for conditions Kodi cannot parse.

- unbalanced ( ) or [ ] in <visible>, <enable>, condition="..." and similar
- a whole condition that is only $PARAM[x] inside an include that has no default for x
  while some <include content="..."> call does not pass x (Kodi gets an empty expression: "Misplaced ]")

Usage: python skin_expr_check.py [skin xml dir]   (default: the installed skin.fentastic)
Exit code 1 when something was found."""
import os
import re
import sys

COND_TAGS = re.compile(r'<(visible|enable|selected|usealttexture|hidden|onclick)\b[^>]*>(.*?)</\1>', re.S)
COND_ATTR = re.compile(r'\b(condition|visible)="([^"]*)"')


def balanced(expr):
    """-> None when fine, else a short reason"""
    stack = []
    pairs = {')': '(', ']': '['}
    for ch in re.sub(r'\$(?:INFO|VAR|EXP|PARAM|LOCALIZE|ESCINFO|ESCVAR|NUMBER|ADDON)\[', '[', expr):
        if ch in '([':
            stack.append(ch)
        elif ch in ')]':
            if not stack or stack[-1] != pairs[ch]:
                return 'unmatched ' + ch
            stack.pop()
    return 'unclosed ' + stack[-1] if stack else None


def _line(text, pos):
    return text.count('\n', 0, pos) + 1


def scan(xml_dir):
    """-> list of (file, line, reason, expr)"""
    out = []
    texts = {}
    for fn in sorted(os.listdir(xml_dir)):
        if fn.lower().endswith('.xml'):
            texts[fn] = open(os.path.join(xml_dir, fn), encoding='utf-8', errors='replace').read()
    for fn, t in texts.items():
        clean = re.sub(r'<!--.*?-->', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), t, flags=re.S)
        for m in COND_TAGS.finditer(clean):
            if m.group(1) == 'onclick':
                continue
            r = balanced(m.group(2))
            if r:
                out.append((fn, _line(clean, m.start()), r, m.group(2).strip()))
        for m in COND_ATTR.finditer(clean):
            r = balanced(m.group(2))
            if r:
                out.append((fn, _line(clean, m.start()), r, m.group(2).strip()))
    # $PARAM-only conditions without a default that a caller leaves out
    calls = {}
    for fn, t in texts.items():
        for m in re.finditer(r'<include\s+content="([^"]+)"[^>]*?(/>|>(.*?)</include>)', t, re.S):
            calls.setdefault(m.group(1), []).append(set(re.findall(r'<param\s+name="([^"]+)"', m.group(3) or '')))
        for m in re.finditer(r'<include>\s*([^<\s]+)\s*</include>', t):
            calls.setdefault(m.group(1), []).append(set())
    for fn, t in texts.items():
        for m in re.finditer(r'<include\s+name="([^"]+)"[^>]*>(.*?)<definition>(.*?)</definition>', t, re.S):
            name, head, body = m.group(1), m.group(2), m.group(3)
            defaults = set(re.findall(r'<param\s+name="([^"]+)"', head))
            for v in re.finditer(r'<visible>\s*!?\$PARAM\[(\w+)\]\s*</visible>', body):
                k = v.group(1)
                if k in defaults:
                    continue
                if any(k not in passed for passed in calls.get(name, [])):
                    out.append((fn, _line(t, m.start(3) + v.start()), 'param %s has no default in %s' % (k, name),
                                v.group(0).strip()))
    return out


def main():
    xml = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('APPDATA', ''), 'Kodi', 'addons',
                                                                'skin.fentastic', 'xml')
    found = scan(xml)
    for fn, ln, why, expr in found:
        print('%s:%d: %s: %s' % (fn, ln, why, expr[:160]))
    print('%d problem(s) in %s' % (len(found), xml))
    return 1 if found else 0


if __name__ == '__main__':
    sys.exit(main())
