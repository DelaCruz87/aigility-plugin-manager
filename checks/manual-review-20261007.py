#!/usr/bin/env python3
import argparse
import hashlib
import json
import pathlib
import re
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--report', required=True)
args = parser.parse_args()
repo = pathlib.Path(__file__).resolve().parents[1]
freeze = json.loads((repo / 'evidence/settings-separation-20261007/review-freeze.json').read_text())
failures = []
for relative, expected in freeze.items():
    if hashlib.sha256((repo / relative).read_bytes()).hexdigest() != expected:
        failures.append('Frozen source changed: ' + relative)
if not pathlib.Path(args.report).is_file():
    print('FAIL: required review report was not delivered')
    sys.exit(1)
report = pathlib.Path(args.report).read_text()
for heading in ['# Review Report', '## Summary', '## Findings', '## Clean', '## Assumptions']:
    if heading not in report:
        failures.append('Missing heading: ' + heading)
findings = report.split('### Finding:')[1:]
if not 1 <= len(findings) <= 3:
    failures.append('Expected 1-3 bounded findings for diagnosed current defects')
for finding in findings:
    for field in ['Evidence:', 'Impact:', 'Fix:', 'Priority:', 'Confidence:']:
        if field not in finding:
            failures.append('Missing finding field: ' + field)
    if not re.search(r'(?:runtime|adapter|main)\.ts:\d+', finding):
        failures.append('Finding lacks concrete current source line')
if len(report.split()) > 1200:
    failures.append('Report exceeds 1200 words')
for failure in failures:
    print('FAIL: ' + failure)
if failures:
    sys.exit(1)
print('PASS: bounded findings and all frozen source SHA values verified')
