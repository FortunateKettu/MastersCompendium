"""Masters Compendium — запуск."""
from __future__ import annotations

import sys


def main() -> int:
    from PyQt6.QtCore import QLockFile, Qt
    from PyQt6.QtWidgets import QApplication, QMessageBox

    from mc import paths
    from mc.i18n import set_lang, tr
    from mc.settings import Settings
    from mc.ui.main_window import MainWindow
    from mc.ui.style import ErrorDialog, apply_style, app_icon

    if sys.platform == "win32":
        # своя иконка на панели задач (а не иконка python.exe)
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(f"Kettu.{paths.APP_ID}")
        except (AttributeError, OSError):
            pass

    QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    app = QApplication(sys.argv)
    app.setApplicationName(paths.APP_NAME)
    app.setWindowIcon(app_icon())
    apply_style(app)

    try:
        paths.ensure_dirs()
    except OSError as e:
        QMessageBox.critical(None, paths.APP_NAME,
                             f"Не могу создать папку с данными (папка только для чтения?):\n"
                             f"Cannot create the data folder (read-only location?):\n\n{paths.DATA_DIR}\n\n{e}")
        return 1
    settings = Settings.load()
    set_lang(settings.lang)

    # одна копия программы: вторая мешала бы серверу (тот же порт)
    lock = QLockFile(str(paths.DATA_DIR / "app.lock"))
    if not lock.tryLock(100):
        QMessageBox.information(None, paths.APP_NAME,
                                "Masters Compendium уже запущен." if settings.lang == "ru"
                                else "Masters Compendium is already running.")
        return 0

    win = MainWindow(settings)

    def excepthook(exc_type, exc, tb):
        import traceback
        details = "".join(traceback.format_exception(exc_type, exc, tb))
        paths.log(f"[unhandled] {details}")
        try:
            ErrorDialog(f"{exc_type.__name__}: {exc}\n\n{tr('error.details')}", details, win).exec()
        except Exception:
            pass

    sys.excepthook = excepthook
    win.show()
    rc = app.exec()
    lock.unlock()
    return rc


if __name__ == "__main__":
    sys.exit(main())
