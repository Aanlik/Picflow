from pixcake_bridge.filenames import normalize_filename


def test_repairs_chinese_multipart_name_without_changing_unicode_or_latin_names():
    name = '客户补充照片.jpg'
    assert normalize_filename(name.encode('utf8').decode('latin1')) == name
    assert normalize_filename(name) == name
    assert normalize_filename('café.jpg') == 'café.jpg'
    assert normalize_filename('DSC00001.JPG') == 'DSC00001.JPG'
