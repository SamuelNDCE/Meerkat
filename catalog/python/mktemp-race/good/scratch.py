import os
import tempfile


def scratch_name():
    fd, name = tempfile.mkstemp()
    os.close(fd)
    return name
