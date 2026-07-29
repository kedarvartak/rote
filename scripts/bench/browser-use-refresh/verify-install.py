#!/usr/bin/env python3
"""Fail unless the isolated environment contains the frozen Browser Use release."""

from importlib import metadata

EXPECTED = '0.13.7'
actual = metadata.version('browser-use')
if actual != EXPECTED:
    raise SystemExit(f'browser-use version mismatch: expected {EXPECTED}, installed {actual}')
print(f'browser-use {actual} install verified')
