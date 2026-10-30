"""Recover the Latin-1 view of UTF-8 multipart names without guessing paths."""
def normalize_filename(value: str) -> str:
    if not value or any(ord(c) > 255 for c in value):
        return value
    try:
        decoded = value.encode('latin1').decode('utf8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value
    if any('\u3400' <= c <= '\u9fff' for c in decoded) or any(c in value for c in ('Ã', 'Â', 'â')):
        return decoded
    return value
