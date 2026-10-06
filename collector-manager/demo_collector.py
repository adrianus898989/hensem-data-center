#!/usr/bin/env python3
"""Harmless local demo: no browser, orders, network, credentials or TG calls."""
import signal
import time

running = True


def stop(_signum, _frame):
    global running
    running = False


signal.signal(signal.SIGINT, stop)
while running:
    time.sleep(0.2)
