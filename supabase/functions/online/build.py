import re
src=open('/home/claude/moustafaahussien/21csu/online-learning-script.gs',encoding='utf-8').read()
a=src.index('/* ---------------- نقطة الدخول ---------------- */'); b=src.index('/* ---------------- إيقاف التعليم عن بعد')
src=src[:a]+src[b:]
def drop(name):
    global src
    m=re.search(r'^function '+re.escape(name)+r'\(', src, re.M)
    assert m, name
    i=src.index('{', m.end()); depth=0; j=i
    while True:
        ch=src[j]
        if ch=='{': depth+=1
        elif ch=='}':
            depth-=1
            if depth==0: break
        j+=1
    src=src[:m.start()]+'/* '+name+' — مُعاد تعريفه في آخر الملف */'+src[j+1:]
for n in ['isSession_','parseSession_','isSysAdmin_','accountsMap_','accountFor_','sessionCode_','adminFromCode_','readAll_','meetDay_','gsignin_','makeSession_','sessionSecret_','hexOf_','setupGoogleSignIn','setupWarmCache','setupDailyReport','testCode','testReport','warmCache']:
    drop(n)
out=open('shim.ts',encoding='utf-8').read()+'\n/* ======== السكربت الأصلي (online-learning-script.gs) ======== */\n'+src+open('tail.ts',encoding='utf-8').read()
open('index.ts','w',encoding='utf-8').write(out)
print(len(out))
