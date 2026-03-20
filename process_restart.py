import logging
import os
import subprocess
import time


def restart_command(executable, argv):
    """再起動時に実行するコマンド配列を返す。"""
    return [executable, *argv]


def restart_process_in_place(
    executable,
    argv,
    cwd,
    execv=os.execv,
    popen=subprocess.Popen,
    exit_fn=os._exit,
    sleep_fn=time.sleep,
    logger=None,
):
    """同じコンソールを維持したままプロセス再起動を試みる。"""
    logger = logger or logging.getLogger(__name__)
    command = restart_command(executable, argv)

    logger.info(f"🔄 Python実行パス: {executable}")
    logger.info(f"🔄 起動引数: {argv}")

    try:
        execv(executable, command)
    except Exception as exec_error:
        logger.error(f"❌ execv再起動失敗: {exec_error}")

    try:
        popen(command, cwd=cwd)
        logger.info("✅ 同じコンソールで新プロセス起動完了。現プロセスを終了します...")
        sleep_fn(2)
        exit_fn(0)
    except Exception as spawn_error:
        logger.error(f"❌ プロセス再起動失敗: {spawn_error}")
        logger.error("🚨 強制終了します。手動で再起動してください。")
        exit_fn(1)
