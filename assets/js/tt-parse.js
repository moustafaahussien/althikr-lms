/* قراءة جدول الحصص من ملف Excel (نفس منطق مكتب الإشراف التربوي) — يُستخدم في «إعدادات المدرسة» */
(function () {
const DAY_ALIASES = {"الأحد":0,"الاحد":0,"الاثنين":1,"الإثنين":1,"الثلاثاء":2,"الأربعاء":3,"الاربعاء":3,"الخميس":4};
const EN_NAMES = {hussain:"حسين",hussein:"حسين",mostafa:"مصطفى",mustafa:"مصطفى",ziyad:"زياد",ziad:"زياد",ibrahim:"ابراهيم",wahab:"وهاب",ramadan:"رمضان"};
const NAME_FIX = {"ابراهم":"ابراهيم","إبراهيم":"ابراهيم"};
function parseLine(line, sheetIdx){
  line = line.replace(/\s+/g," ").trim();
  if(!line) return null;
  if(!line.includes(" | ") && /اجتماع(?!يات)|meeting/i.test(line)) return {kind:"event", text:line};
  let subj="", room="";
  if(line.includes(" | ")){ const ps=line.split(" | "); line=ps[0].trim(); subj=(ps[1]||"").trim(); room=(ps[2]||"").trim(); }
  let name=line, cls="";
  const m = line.match(/^(.+?)\s+(\d{1,2}\s*-\s*\S+|\d{1,2}\s*[A-Za-z])$/);
  if(m){ name=m[1].trim(); cls=m[2].replace(/\s+/g,""); }
  let track="arabic";
  const en = name.toLowerCase();
  if(EN_NAMES[en]){ name=EN_NAMES[en]; track="american"; }
  else if(/^[A-Za-z]/.test(name)) track="american";
  if(NAME_FIX[name]) name=NAME_FIX[name];
  if(cls && /[A-Za-z]$/.test(cls)) track="american";
  let gradeNum=null, section="";
  if(cls){
    const g = cls.match(/^(\d{1,2})-?(.*)$/);
    if(g){ gradeNum=+g[1]; section=g[2]; }
  }
  return {kind: cls?"class":"free", teacher:name, cls, track, gradeNum, section, subj, room};
}

function parseSheets(raw){
  const sheets=[], entries=[]; let maxP=0;
  raw.forEach((sh, sIdx)=>{
    const rows = sh.rows||[];
    let hdr = rows.findIndex(r=> r.slice(1).filter(c=>/^\d+$/.test(String(c).trim())).length>=3);
    if(hdr<0) return;
    const perCols=[]; rows[hdr].forEach((c,i)=>{ if(i>0 && /^\d+$/.test(String(c).trim())) perCols.push({col:i,p:+String(c).trim()}); });
    let title = (rows.slice(0,hdr).flat().find(c=>String(c).trim())||"").toString().trim();
    sheets.push({idx:sIdx, name:sh.name, title});
    for(let r=hdr+1;r<rows.length;r++){
      const dname = String(rows[r][0]||"").trim();
      if(!(dname in DAY_ALIASES)) continue;
      const day = DAY_ALIASES[dname];
      perCols.forEach(({col,p})=>{
        maxP=Math.max(maxP,p);
        const cell = String(rows[r][col]||"");
        cell.split(/\r?\n/).forEach((ln,i)=>{
          const e = parseLine(ln, sIdx); if(!e) return;
          e.sheet=sIdx; e.day=day; e.period=p;
          e.key = [sIdx,day,p,e.teacher||e.text,e.cls||""].join("|");
          entries.push(e);
        });
      });
    }
  });
  // إزالة التكرار داخل نفس الخلية
  const seen=new Set(); const uniq=entries.filter(e=>{ if(seen.has(e.key)) return false; seen.add(e.key); return true; });
  return {sheets, entries:uniq, nper:maxP||9};
}


  window.TTParse = { parseSheets, parseLine };
})();
