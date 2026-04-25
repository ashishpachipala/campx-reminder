const puppeteer = require('puppeteer');
const twilio = require('twilio');
const EMAIL = process.env.CAMPX_EMAIL;
const PASSWORD = process.env.CAMPX_PASSWORD;
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
const TWILIO_WA = process.env.TWILIO_WHATSAPP || '+14155238886';
const MY_PHONE = process.env.MY_PHONE;
const CAMPX_URL = 'https://mruh.campx.in/mruh/student-workspace/learning-management/2199/assessments';

function todayISO() { return new Date().toISOString().split('T')[0]; }
function currentHourIST() { return new Date(new Date().getTime() + 5.5*60*60*1000).getHours(); }
function normalizeDate(raw) {
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const m = raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
    if (m) { let[,d,mo,y]=m; if(y.length===2)y='20'+y; return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`; }
    return new Date(raw).toISOString().split('T')[0];
  } catch { return ''; }
}
async function sendWhatsApp(msg) {
  try { const r = await client.messages.create({from:`whatsapp:${TWILIO_WA}`,to:`whatsapp:${MY_PHONE}`,body:msg}); console.log('WhatsApp sent:',r.sid); }
  catch(e) { console.error('WhatsApp failed:',e.message); }
}
async function makeCall(name) {
  try { const r = await client.calls.create({from:TWILIO_WA,to:MY_PHONE,twiml:`<Response><Say voice="alice" language="en-IN">Urgent! Your assignment ${name} is due today. Submit on CampX immediately!</Say></Response>`}); console.log('Call:',r.sid); }
  catch(e) { console.error('Call failed:',e.message); }
}
async function scrapeCampX() {
  const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process']});
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    await page.goto('https://mruh.campx.in',{waitUntil:'networkidle2',timeout:30000});
    if (await page.$('input[type="password"]')) {
      const emailSel='input[type="email"],input[name="email"],input[name="username"]';
      await page.waitForSelector(emailSel,{timeout:10000});
      await page.type(emailSel,EMAIL,{delay:60});
      await page.type('input[type="password"]',PASSWORD,{delay:60});
      const btn=await page.$('button[type="submit"]');
      if(btn) await btn.click(); else await page.keyboard.press('Enter');
      await page.waitForNavigation({waitUntil:'networkidle2',timeout:20000}).catch(()=>{});
    }
    await page.goto(CAMPX_URL,{waitUntil:'networkidle2',timeout:30000});
    await new Promise(r=>setTimeout(r,4000));
    await page.screenshot({path:'debug.png',fullPage:true});
    const today=todayISO();
    const found=await page.evaluate(()=>{
      const results=[];const seen=new Set();
      ['.card','tr','.row','li','[class*="assess"]','[class*="assign"]'].forEach(sel=>{
        document.querySelectorAll(sel).forEach(el=>{
          const text=el.innerText||'';
          const dates=text.match(/\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|\d{4}-\d{2}-\d{2}/g);
          if(dates){const t=(el.querySelector('h1,h2,h3,h4,strong,.title')||{}).innerText||text.split('\n')[0];results.push({title:t.trim().slice(0,100),dates});}
        });
      });
      return results;
    });
    const todayDue=[];const seen2=new Set();
    for(const item of found){for(const d of item.dates){const n=normalizeDate(d);if(n===today){const k=item.title.toLowerCase().slice(0,40);if(!seen2.has(k)){seen2.add(k);todayDue.push(item.title||'Assignment');}}}}
    console.log('Due today:',todayDue.length?todayDue.join(', '):'None');
    return todayDue;
  } finally { await browser.close(); }
}
async function main() {
  const hour=currentHourIST(),today=todayISO();
  console.log(`CampX Scan | ${today} | ${hour}:00 IST`);
  const due=await scrapeCampX();
  if(!due.length){console.log('No assignments due today.');return;}
  for(const name of due){
    if(hour>=6&&hour<10) await sendWhatsApp(`📚 *Good morning!*\n\n*${name}* is due *TODAY* on CampX.\nSubmit now!\n\n🔗 https://mruh.campx.in`);
    else if(hour>=16&&hour<19) await sendWhatsApp(`⏰ *Evening Reminder!*\n\n*${name}* is due TODAY.\nLog into CampX!\n\n🔗 https://mruh.campx.in`);
    else if(hour>=20&&hour<23){await sendWhatsApp(`🚨 *URGENT!*\n\n*${name}* due TODAY! Submit IMMEDIATELY!\n\n🔗 https://mruh.campx.in`);await makeCall(name);}
    else console.log(`Hour ${hour} IST — background scan only.`);
  }
}
main().catch(e=>{console.error('Fatal:',e);process.exit(1);});
