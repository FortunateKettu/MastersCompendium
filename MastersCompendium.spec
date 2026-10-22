# -*- mode: python ; coding: utf-8 -*-
# Masters Compendium Portable: один exe. Данные (настройки, кампании, бэкапы, лог) — рядом с ним в MastersCompendium_data.

DROP = ('opengl32sw.dll', 'qt6pdf.dll', 'qpdf.dll', 'qtiff.dll', 'qwebp.dll', 'qicns.dll', 'qtga.dll',
        'qwbmp.dll', 'qminimal.dll', 'qtuiotouchplugin.dll',
        'qt6quick.dll', 'qt6qml.dll', 'qt6qmlmodels.dll',
        'qt6opengl.dll', 'd3dcompiler_47.dll')
# QtSvg НЕ выкидываем — им рисуются иконки
# QtNetwork НЕ выкидываем — он нужен для списка адаптеров и автопоиска игр

a = Analysis(['main.py'], pathex=[], binaries=[],
             datas=[('icon.ico', '.'), ('logo.png', '.'), ('web', 'web')],
             hiddenimports=['qrcode', 'qrcode.constants', 'qrcode.util', 'qrcode.base',
                            'aiohttp', 'PyQt6.QtNetwork', 'PyQt6.QtSvg'],
             excludes=['tkinter', 'unittest', 'pydoc', 'pdb', 'doctest', 'PIL', 'PyQt6.QtQml', 'PyQt6.QtQuick',
                       'PyQt6.QtWebEngineCore', 'PyQt6.QtMultimedia', 'PyQt6.QtPdf'],
             noarchive=False)


def keep(entry):
    name = entry[0].replace('\\', '/').lower()
    if name.split('/')[-1] in DROP:
        return False
    if '/translations/' in name or name.endswith('.qm'):
        return False
    return True


a.binaries = [b for b in a.binaries if keep(b)]
a.datas = [d for d in a.datas if keep(d)]
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='MastersCompendium', debug=False, strip=False,
          upx=False, runtime_tmpdir=None, console=False, icon=['icon.ico'])
