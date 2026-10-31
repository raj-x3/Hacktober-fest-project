# tests/conftest.py
import pytest

def pytest_configure(config):
    config.addinivalue_line(
        "markers", "network: marks tests that require a live internet connection"
    )
