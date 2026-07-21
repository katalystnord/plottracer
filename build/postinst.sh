#!/bin/bash
# Fix chrome-sandbox permissions required by Chromium's SUID sandbox.
# Must be owned by root:root with mode 4755 (setuid bit).
# This runs as root during 'dpkg -i' / 'apt install'.
if [ -f /opt/plottracer/chrome-sandbox ]; then
    chown root:root /opt/plottracer/chrome-sandbox
    chmod 4755 /opt/plottracer/chrome-sandbox
fi
