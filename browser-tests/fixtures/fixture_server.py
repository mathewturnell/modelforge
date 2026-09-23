"""Start the installed candidate with disposable, public-independent projects."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import signal
import sys
import threading
from pathlib import Path

from modelforge_workbench.alpha import AlphaWorkbench
from modelforge_workbench.workbench.server import _Server


TOKEN = "public-browser-fixture-token"
VIDEO = base64.b64decode(
    "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAPWbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAggAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAwF0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAggAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAKAAAABaAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAIIAAAEAAABAAAAAAJ5bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAAGgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACJG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAeRzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAKAAWgBIAAAASAAAAAAAAAABFUxhdmM2Mi4xMS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAL/+EAGWdkAAus2UKN+TARAAADAAEAAAMAMg8UKZYBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAANkQAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAA0AAAIAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAB4Y3R0cwAAAAAAAAANAAAAAQAABAAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAA0AAAABAAAASHN0c3oAAAAAAAAAAAAAAA0AAALbAAAADwAAAA0AAAAMAAAADAAAABUAAAAPAAAADAAAAAwAAAAVAAAADwAAAAwAAAAMAAAAFHN0Y28AAAAAAAAAAQAABAYAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYyLjMuMTAwAAAACGZyZWUAAAOPbWRhdAAAAqAGBf//nNxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MyBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0wIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAzZYiEADv//uOr+BTEWCcnJxOfNDRjT88Ul2zyEzccsFUPz6rlbvBltktL8gDIAAXkH/+RAAAAC0GaJGxDf/6nhAHHAAAACUGeQniF/wDzgQAAAAgBnmF0Qr8BUwAAAAgBnmNqQr8BUwAAABFBmmhJqEFomUwIZ//+nhAGzQAAAAtBnoZFESwv/wDzgQAAAAgBnqV0Qr8BUwAAAAgBnqdqQr8BUwAAABFBmqxJqEFsmUwIV//+OEAaMAAAAAtBnspFFSwv/wDzgQAAAAgBnul0Qr8BUwAAAAgBnutqQr8BUw=="
)
DOCUMENTATION_VIDEO = base64.b64decode(
    "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAOLbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAA"
    "AAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAA"
    "ArZ0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAA"
    "AAAAAAAAAAAAAABAAAAAAUAAAAC0AAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAIAAABAAAAAAIubWRpYQAAACBtZGhk"
    "AAAAAAAAAAAAAAAAAAAwAAAAMABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAB2W1p"
    "bmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAZlzdGJsAAAAwXN0c2QA"
    "AAAAAAAAAQAAALFhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAUAAtABIAAAASAAAAAAAAAABFUxhdmM2Mi4xMS4xMDAgbGli"
    "eDI2NAAAAAAAAAAAAAAAGP//AAAAN2F2Y0MBZAAM/+EAGmdkAAys2UFBn58BEAAAAwAQAAADAYDxQplgAQAGaOvjyyLA/fj4AAAA"
    "ABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAD/YAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAMAAAEAAAAABRzdHNzAAAAAAAAAAEA"
    "AAABAAAAMGN0dHMAAAAAAAAABAAAAAIAAAgAAAAAAQAADAAAAAABAAAEAAAAAAgAAAgAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAM"
    "AAAAAQAAAERzdHN6AAAAAAAAAAAAAAAMAAAEPgAAAJoAAAC3AAAAOwAAAEsAAABIAAAAQwAAAFAAAABFAAAARwAAAEAAAAA/AAAA"
    "FHN0Y28AAAAAAAAAAQAAA7sAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxp"
    "bHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYyLjMuMTAwAAAACGZyZWUAAAgDbWRhdAAAAqAGBf//nNxF6b3m2Ui3lizY"
    "INkj7u94MjY0IC0gY29yZSAxNjUgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDov"
    "L3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9"
    "MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hy"
    "b21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zm"
    "c2V0PS0yIHRocmVhZHM9NiBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVy"
    "bGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0x"
    "IGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MTIg"
    "c2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9"
    "MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAGWZYiEAD///uZ1+BTZ8gYH"
    "GbEafniku2qQ03N0Uz0KN/AMAJSUDKr6GTwCqUvEeO/e3P/mAakfj80Q7UDUpa+AJ38HgNFV+lNq8rZBpK0BrPl9bumVKbGQdsaw"
    "r9pw3e0H4toCGkOKxe9BbCZWDjadiN+jPKddFKYhYWg9y8rcRtn/adCmdm2fZzYztxw35JTfA7gUwwiW6rMnoz/kjdRZA35MWKv2"
    "vt0m0oWkMAGlStGLI4dm4+iWoRYoFlD/AbFmBpniJqbUmONAN3DLdRGehuD0qLfNKw2mEmzEJ7JCfoaQeLNC/9uKmBxBtXOnXw2W"
    "jHv6IfoxCW3f8jldWvv/mp2Yrt0S+qfFlHqdwfKgfgTKH/VzHS8xLRzljRoT5OPsa16tT8f24HtR0ZT7tPe3g0ymS6aX7aoRP89I"
    "EVbnQBcTrv72XXD1fQMs8JbDMw36RvDS0GhCCu/XvJbgUHXezAgTypWuH+qepoUkqg7oY/vWkUZdjdhwMT/gsbpdsJKy57zPqBIU"
    "kKGIay8FTJI25QAWWQCrgQAAAJZBmiFsQ//+qZYDliRYuXiAZKyNizq/xLhFtv/2QTn5hq5TgpgCi9Gs5NZfP1pgTPlef+HhWLWC"
    "xziehMjzbX+hT16QyIk5hBQQ97xZyo7TP07bVSFVXPjiNMCflkBVBAMmDRrEbC+DssBIXOTN1uxz/8E4l65rAYHhKTK1VbU+JILP"
    "9wgMnyG0SPHQqnxwVAl/RZ/JLmoAAACzQZpDPCGTKYQ7//6plgM3xBaWprpXVjDwBG6q/yWi0xi0AqN/I7GSyb1r4/inzVD0yX3y"
    "jxfehIeZhWOBED5ZsPr78DcYHi6bGz3AQayaDIDfEpHMUYKftf91VTdGmzbmH2KRHkes7aB9vWXQNfyFS8uJkBqQ7ag3+BmwUinO"
    "nV+Et7KJQeahAF261PpfNIa2DNvQA5GpfgxnNA6S4AeaE80rHzoe/2XgiIi+Un5bMdEVroEAAAA3AZ5iakM/ASnjGRs1HYB/8wqp"
    "uYjkK3YpbxdeIrnsQZRpeNoSJp4OOxwhcpJ41N+gzwsq13wdxwAAAEdBmmRJ4Q8mUwId//6plgMxyrneGAmRn+U4JnqJ04rea5rf"
    "hl1SmpbgZF7HuTWWSE352bj6wLvqkUsm2tjzUdk9WrUNVYZ/bwAAAERBmoVJ4Q8mUwId//6plgLlykN66zCzNyz66yIJZ3Ytvg3U"
    "n5sZ8AhUMIJUPr76zktg1VvwpXCl13LLWTEEjP1j2rgY0wAAAD9BmqZJ4Q8mUwId//6plgIx2olWZuiFXfLXBTlnQrK9ygJR6vtU"
    "fskG+OIz/eEYPdxspFBKdPHhugGgq6AIe1MAAABMQZrHSeEPJlMCHf/+qZYCAdqJVmbohV3y1wU5Z0KyvcoCUer7VH7JDuWWGxGP"
    "CGNluVTJkroui2e2/5fp08JI6HLDTjpxwLyPU2RX5QAAAEFBmuhJ4Q8mUwId//6plgHV4fsHR14OZPlrgpyzoVle5QEo9X2qP2SD"
    "fHEZ4Q2C+9qR8bup5xXM+Ny2ixA+pZVK0AAAAENBmwlJ4Q8mUwId//6plgGy6WSrM3RS3IvhUvUZ0Ky3coCWDr7WH7KhvjiNCnwR"
    "mNXl4HEZnUsoCI5SQFJoj5u2BkWwAAAAPEGbKknhDyZTAhv//qeEAyXSx/w+w7txrSfgi8OJEFKT5Y+q3AeLzboGmZqx0gQLqlZn"
    "9wxaKDkeXREvgQAAADtBm0tJ4Q8mUwIZ//6eEAr/bgac1jJmaMjO3RArdaAiAxxpqVtif0dFP/DZ5xvdI6cEHa79o8okwAfmlA=="
)


# Original black32x18 video:203frames at5fps, generated without any model.
TIMELINE_VIDEO = base64.b64decode(
    "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAy+bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAnpgAAQAAAQAAAAAAAAAAAAAAAAEAAAAA"
    "AAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAC+l0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAAB"
    "AAAAAAAAnpgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAACAAAAASAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAA"
    "AAEAAJ6YAAAQAAABAAAAAAthbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAGWABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRl"
    "b0hhbmRsZXIAAAALDG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAACsxzdGJsAAAAwHN0c2QA"
    "AAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAACAAEgBIAAAASAAAAAAAAAABFUxhdmM2Mi4xMS4xMDAgbGlieDI2NAAAAAAAAAAAAAAA"
    "GP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2Ul+IwEQAAADABAAAAMAoPEiWWABAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAAsAA"
    "AAAAAAAAGHN0dHMAAAAAAAAAAQAAAMsAAAgAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAZoY3R0cwAAAAAAAADLAAAAAQAAEAAAAAABAAAoAAAAAAEAABAAAAAA"
    "AQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEA"
    "ABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAo"
    "AAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAA"
    "AAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAA"
    "AQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEA"
    "AAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQ"
    "AAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAA"
    "AAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAA"
    "AQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEA"
    "AAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAA"
    "AAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAA"
    "AAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAA"
    "AQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAIAAAAAAEA"
    "ACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAAAAABAAAI"
    "AAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAQAAAAAA"
    "AAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAA"
    "AQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAABAAAoAAAAAAEA"
    "ABAAAAAAAQAAAAAAAAABAAAIAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAAQAAGAAAAAABAAAIAAAAABxzdHNjAAAAAAAAAAEAAAABAAAA"
    "ywAAAAEAAANAc3RzegAAAAAAAAAAAAAAywAAArwAAAANAAAADAAAAAwAAAAMAAAAEwAAAA4AAAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAADgAAAAwA"
    "AAAMAAAAEwAAAA4AAAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAADgAAAAwAAAAMAAAAEwAAAA4AAAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAA"
    "DgAAAAwAAAAMAAAAEwAAAA4AAAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAADgAAAAwAAAAMAAAAEwAAAA4AAAAMAAAADAAAABMAAAAOAAAADAAAAAwA"
    "AAATAAAADgAAAAwAAAAMAAAAEwAAAA4AAAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAADgAAAAwAAAAMAAAAEwAAAA4AAAAMAAAADAAAABMAAAAOAAAA"
    "DAAAAAwAAAATAAAADgAAAAwAAAAMAAAAEwAAAA4AAAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAADgAAAAwAAAAMAAAAEwAAAA4AAAAMAAAADAAAABMA"
    "AAAOAAAADAAAAAwAAAATAAAADgAAAAwAAAAMAAAAEwAAAA4AAAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAADgAAAAwAAAAMAAAAEwAAAA4AAAAMAAAA"
    "DAAAABMAAAAOAAAADAAAAAwAAAATAAAADgAAAAwAAAAMAAAAEwAAAA4AAAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAADgAAAAwAAAAMAAAAEwAAAA4A"
    "AAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAADgAAAAwAAAAMAAAAEwAAAA4AAAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAADgAAAAwAAAAMAAAA"
    "EwAAAA4AAAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAADgAAAAwAAAAMAAAAEwAAAA4AAAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAADgAAAAwA"
    "AAAMAAAAEwAAAA4AAAAMAAAADAAAABQAAAAMAAAAFHN0Y28AAAAAAAAAAQAADO4AAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBw"
    "bAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYyLjMuMTAwAAAACGZyZWUAAA3+bWRhdAAAAp8GBf//m9xF6b3m2Ui3lizY"
    "INkj7u94MjY0IC0gY29yZSAxNjUgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5v"
    "cmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0x"
    "IHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIx"
    "LDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBk"
    "ZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0x"
    "IGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49NSBzY2VuZWN1dD00MCBpbnRy"
    "YV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQg"
    "aXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAABVliIQAFP/+98dPwKbq3CLLnEkAf+EAAAAJQZokbEFP/tbgAAAACEGeQniCHzUhAAAACAGeYXRD/0RAAAAA"
    "CAGeY2pD/0RBAAAAD0GaaEmoQWiZTAgp//7W4QAAAApBnoZFESwQ/zUhAAAACAGepXRD/0RBAAAACAGep2pD/0RAAAAAD0GarEmoQWyZTAgp//7W4AAAAApB"
    "nspFFSwQ/zUhAAAACAGe6XRD/0RAAAAACAGe62pD/0RAAAAAD0Ga8EmoQWyZTAgp//7W4QAAAApBnw5FFSwQ/zUhAAAACAGfLXRD/0RBAAAACAGfL2pD/0RA"
    "AAAAD0GbNEmoQWyZTAgp//7W4AAAAApBn1JFFSwQ/zUhAAAACAGfcXRD/0RAAAAACAGfc2pD/0RAAAAAD0GbeEmoQWyZTAgp//7W4QAAAApBn5ZFFSwQ/zUg"
    "AAAACAGftXRD/0RBAAAACAGft2pD/0RBAAAAD0GbvEmoQWyZTAgp//7W4AAAAApBn9pFFSwQ/zUhAAAACAGf+XRD/0RAAAAACAGf+2pD/0RBAAAAD0Gb4Emo"
    "QWyZTAgp//7W4QAAAApBnh5FFSwQ/zUgAAAACAGePXRD/0RAAAAACAGeP2pD/0RBAAAAD0GaJEmoQWyZTAgp//7W4AAAAApBnkJFFSwQ/zUhAAAACAGeYXRD"
    "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"
)

def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def authored_manifest(project_id: str, name: str, action_id: str, interface: str, protocol: str) -> dict:
    return {
        "schema_version": 1,
        "id": project_id,
        "name": name,
        "repository": ".",
        "runtime": {
            "protocol": "modelforge.project-runtime/v1",
            "actions": {action_id: {
                "kind": "executable",
                "interface": interface,
                "executable": "managed_worker.py",
                "result_contract": {"protocol": protocol},
            }},
        },
    }


def configure_projects(
    app: AlphaWorkbench, root: Path, worker: Path, *, documentation: bool = False,
) -> None:
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    vision = root / "vision-project"
    prompt = root / "prompt-project"
    dataset = root / "dataset"
    for directory in (vision, prompt, dataset):
        directory.mkdir(mode=0o700, exist_ok=True)
    vision_id = "bdd100k-docs-fixture" if documentation else "vision-fixture"
    vision_name = (
        "BDD100K Road Scene Lab · synthetic docs fixture"
        if documentation else "Synthetic Vision Lab"
    )
    prompt_id = "qwen-docs-fixture" if documentation else "prompt-fixture"
    prompt_name = (
        "Qwen2.5-7B Prompt Lab · synthetic docs fixture"
        if documentation else "Synthetic Prompt Lab"
    )
    write_json(vision / "project.json", authored_manifest(
        vision_id, vision_name, "inference", "inference_process",
        "modelforge.inference-result/v1",
    ))
    write_json(prompt / "project.json", authored_manifest(
        prompt_id, prompt_name, "prompt", "prompt_process",
        "modelforge.prompt-result/v1",
    ))
    samples = []
    for mode in ("success", "cancel", "failure", "invalid"):
        sample = dataset / f"{mode}.mp4"
        sample.write_bytes(
            (DOCUMENTATION_VIDEO if documentation else VIDEO) + mode.encode("ascii")
        )
        samples.append({
            "id": mode,
            "name": f"{mode.title()} synthetic clip",
            "path": sample.name,
            "split": "train",
            "content_type": "video/mp4",
            "size_bytes": sample.stat().st_size,
            "sha256": digest(sample),
        })
    checkpoint = root / "checkpoint.bin"
    checkpoint.write_bytes(b"public browser fixture checkpoint\n")
    vision_config = {
        "protocol": "modelforge.local-runtime-configuration/v1",
        "id": vision_id,
        "project_repository": str(vision),
        "name": vision_name,
        "description": (
            "Safe authored media exercising the current BDD100K-shaped workflow; "
            "no dataset, checkpoint, or model is loaded."
            if documentation else
            "Redistributable tracked-video-shaped fixture; no model is loaded."
        ),
        "support_level": "conformance-fixture",
        "action": {
            "id": "inference",
            "kind": "inference",
            "interface": "inference_process",
            "display_name": "Run synthetic vision fixture",
            "result_protocol": "modelforge.inference-result/v1",
            "interpreter": sys.executable,
            "executable": str(worker),
            "working_directory": str(vision),
            "arguments": ["--dataset-root", "{dataset_root}", "--artifact", "{artifact}", "--checkpoint", "{checkpoint}", "--output-dir", "{output}", "--device", "{device}", "--max-frames", "{max_frames}"],
            "environment": {},
            "parameters": {"device": "cpu", "max_frames": 1},
        },
        "dataset": {"id": "clips", "name": "Synthetic clips", "root": str(dataset), "samples": samples},
        "bindings": {"checkpoint": {"id": "fixture-checkpoint", "path": str(checkpoint), "sha256": digest(checkpoint)}},
    }
    model = root / "fake-model"
    model.mkdir(mode=0o700, exist_ok=True)
    prompt_config = {
        "protocol": "modelforge.local-runtime-configuration/v1",
        "id": prompt_id,
        "project_repository": str(prompt),
        "name": prompt_name,
        "description": (
            "Safe authored prompts exercising the current Qwen-shaped workflow; "
            "no model or provider is loaded."
            if documentation else
            "Redistributable prompt-shaped fixture; no model is loaded."
        ),
        "support_level": "conformance-fixture",
        "action": {
            "id": "prompt",
            "kind": "prompt",
            "interface": "prompt_process",
            "display_name": "Run synthetic prompt fixture",
            "result_protocol": "modelforge.prompt-result/v1",
            "interpreter": sys.executable,
            "executable": str(worker),
            "working_directory": str(prompt),
            "arguments": ["--request", "{request}", "--output", "{output}"],
            "environment": {},
            "parameters": {},
        },
        "bindings": {"model": {"path": str(model), "model_id": "fixture/model", "revision": "fixture-revision"}},
    }
    if not documentation:
        timeline = dataset / "timeline.mp4"
        timeline.write_bytes(TIMELINE_VIDEO)
        vision_config["dataset"]["samples"].append({
            "id": "timeline", "name": "Long authored timeline", "path": timeline.name,
            "split": "train", "content_type": "video/mp4", "size_bytes": timeline.stat().st_size,
            "sha256": digest(timeline),
        })
        vision_config["dataset"]["samples"].append({
            **samples[0], "id": "protected", "name": "Protected test clip", "split": "test",
        })
        descriptor = root / "vision-model.json"
        write_json(descriptor, {
            "protocol": "modelforge.model-descriptor/v1", "model_id": "fixture-model",
            "name": "Authored fixture architecture",
            "checkpoint": {"sha256": digest(checkpoint)},
            "nodes": [
                {"id": "encoder", "label": "Image encoder", "kind": "encoder", "parameter_count": 42, "category": "encoder", "detail": "[B, 3, 8, 8]", "config": {"native_class_count": 8}},
                {"id": "head", "label": "Tracking head", "kind": "head"},
            ],
            "edges": [{"source": "encoder", "target": "head"}],
            "sources": [{"id": "authored", "name": "Authored fixture backbone", "revision": "fixture-revision", "node_ids": ["encoder"]}],
            "brief": {"description": "Authored structural fixture; no model is loaded.", "rationale": ["Deterministic browser graph inspection."], "goals": ["Keep safe descriptor identity visible."]},
        })
        vision_config["bindings"]["model_descriptor"] = {"path": str(descriptor), "sha256": digest(descriptor)}

    for name, value in (("vision.json", vision_config), ("prompt.json", prompt_config)):
        config = root / name
        write_json(config, value)
        app.register_project(config)

    if not documentation:
        app.annotations.save(vision_id, "clips", "timeline", {
            "expected_revision": 0,
            "annotations": [
                {"id": f"frame-{frame}", "frame": frame, "label": "authored object",
                 "track_id": "authored-track", "x": .1, "y": .1, "width": .2, "height": .2}
                for frame in range(1, 204)
            ],
        })

    if documentation:
        taste = root / "tastematch-project"
        taste.mkdir(mode=0o700, exist_ok=True)
        taste_id = "tastematch-docs-fixture"
        taste_name = "TasteMatch · synthetic docs fixture"
        write_json(taste / "project.json", authored_manifest(
            taste_id, taste_name, "inference", "inference_process",
            "modelforge.inference-result/v1",
        ))
        image = dataset / "authored-food-plate.svg"
        image.write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" '
            'viewBox="0 0 640 360"><rect width="640" height="360" fill="#171b18"/>'
            '<circle cx="320" cy="180" r="135" fill="#e8ece6"/>'
            '<circle cx="320" cy="180" r="105" fill="#d96c3f"/>'
            '<circle cx="275" cy="145" r="22" fill="#f2d36b"/>'
            '<circle cx="365" cy="205" r="28" fill="#f2d36b"/>'
            '<path d="M255 235c45-65 90-65 130 0" fill="none" stroke="#57962a" '
            'stroke-width="18" stroke-linecap="round"/>'
            '<text x="320" y="335" text-anchor="middle" fill="#c9cdd3" '
            'font-family="ui-sans-serif,system-ui,sans-serif" font-size="20">'
            'authored documentation image</text></svg>',
            encoding="utf-8",
        )
        taste_config = {
            "protocol": "modelforge.local-runtime-configuration/v1",
            "id": taste_id,
            "project_repository": str(taste),
            "name": taste_name,
            "description": (
                "Safe authored image and scores exercising the current base-SigLIP "
                "table workflow; no dataset, model, or trained adapter is loaded."
            ),
            "support_level": "conformance-fixture",
            "action": {
                "id": "inference",
                "kind": "inference",
                "interface": "inference_process",
                "display_name": "Run synthetic base-SigLIP fixture",
                "result_protocol": "modelforge.inference-result/v1",
                "interpreter": sys.executable,
                "executable": str(worker),
                "working_directory": str(taste),
                "arguments": [
                    "--dataset-root", "{dataset_root}", "--artifact", "{artifact}",
                    "--checkpoint", "{checkpoint}", "--output-dir", "{output}",
                    "--device", "{device}", "--max-frames", "{max_frames}",
                    "--fixture-kind", "table",
                ],
                "environment": {},
                "parameters": {"device": "cpu", "max_frames": 1},
            },
            "dataset": {
                "id": "images",
                "name": "Authored documentation images",
                "root": str(dataset),
                "samples": [{
                    "id": "food-plate",
                    "name": "Authored food plate",
                    "path": image.name,
                    "split": "documentation",
                    "content_type": "image/svg+xml",
                    "size_bytes": image.stat().st_size,
                    "sha256": digest(image),
                }],
            },
            "bindings": {
                "checkpoint": {
                    "id": "fixture-checkpoint",
                    "path": str(checkpoint),
                    "sha256": digest(checkpoint),
                },
            },
        }
        taste_config_path = root / "tastematch.json"
        write_json(taste_config_path, taste_config)
        app.register_project(taste_config_path)



def configure_training(app: AlphaWorkbench, root: Path) -> None:
    project = root / "training-project"
    project.mkdir(parents=True, exist_ok=True)
    worker = Path(__file__).with_name("training_worker.py").resolve()
    write_json(project / "project.json", authored_manifest(
        "training-fixture", "Synthetic Scalar Training Lab", "training", "training_process",
        "modelforge.training-result/v1",
    ))
    samples = []
    for split, target in (("train", 2.0), ("validation", 2.1), ("test", 999)):
        path = project / f"{split}.json"
        write_json(path, {"target": target, "split": split})
        samples.append({
            "id": split, "name": f"Authored {split} target", "path": path.name,
            "split": split, "content_type": "application/json", "sha256": digest(path),
            "size_bytes": path.stat().st_size,
        })
    config = root / "training.json"
    write_json(config, {
        "protocol": "modelforge.local-runtime-configuration/v1", "id": "training-fixture",
        "project_repository": str(project), "name": "Synthetic Scalar Training Lab",
        "description": "Three actual scalar optimization steps on authored train and validation targets; no model-quality claim.",
        "support_level": "conformance-fixture",
        "action": {
            "id": "training", "kind": "training", "interface": "training_process",
            "display_name": "Train authored scalar", "result_protocol": "modelforge.training-result/v1",
            "interpreter": sys.executable, "executable": str(worker), "working_directory": str(project),
            "arguments": ["--request", "{request}", "--train", "{training_sample}", "--validation", "{validation_sample}", "--output", "{output}"],
            "parameters": {"device": "cpu", "epochs": 1, "max_batches": 3, "learning_rate": 0.1, "seed": 7},
        },
        "dataset": {"id": "scalar-targets", "name": "Authored scalar targets", "root": str(project), "samples": samples},
        "bindings": {},
    })
    app.register_project(config)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--fixture-root", type=Path, required=True)
    parser.add_argument(
        "--mode", choices=("empty", "full", "documentation", "existing"), required=True,
    )
    args = parser.parse_args()
    app = AlphaWorkbench(args.state_root)
    if args.mode in {"full", "documentation"}:
        configure_projects(
            app,
            args.fixture_root,
            Path(__file__).with_name("managed_worker.py").resolve(),
            documentation=args.mode == "documentation",
        )
    if args.mode == "full":
        configure_training(app, args.fixture_root)
    server = _Server(("127.0.0.1", 0), app, TOKEN)
    port = server.server_address[1]
    print(json.dumps({"url": f"http://127.0.0.1:{port}/#token={TOKEN}", "port": port}), flush=True)
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_args: stopped.set())
    signal.signal(signal.SIGINT, lambda *_args: stopped.set())
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    stopped.wait()
    server.shutdown()
    server.server_close()
    thread.join(timeout=3)


if __name__ == "__main__":
    main()
