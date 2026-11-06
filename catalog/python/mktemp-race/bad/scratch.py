import tempfile


def scratch_name():
    return tempfile.mktemp()
