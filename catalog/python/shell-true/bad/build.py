import subprocess


def build(cmd):
    subprocess.run(cmd, shell=True)
