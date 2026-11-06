"""Docstring with import fake_mod inside."""
import os
import json as j, pkg.core
from pkg import core, helpers
from pkg.core import run
from . import sibling
from .missing_rel import nothing
from nowhere import thing

VALUE = 1


def main():
    # import commented_out
    return run()


class App:
    pass


if __name__ == "__main__":
    main()
