#!/usr/bin/env node
/**
 * 네이버 데이터랩 쇼핑인사이트 TOP 500 수집 → data/seeds-{catId}.json 저장
 * 실행: node scripts/scrape-seeds.js --catId=50000000 --topN=80
 *
 * 전체 카테고리 순차 실행:
 *   node scripts/scrape-seeds.js --all
 */
const fs   = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function parseArgs(argv){
  const o={};
  for(const a of argv){
    if(!a.startsWith('--')) continue;
    const [k,...rest]=a.slice(2).split('=');
    o[k]=rest.length?rest.join('='):'true';
  }
  return o;
}

const argv = parseArgs(process.argv.slice(2));

const CAT_MAP = {
  '50000000':{ name:'패션의류',   path:['패션의류'] },
  '50000001':{ name:'패션잡화',   path:['패션잡화'] },
  '50000002':{ name:'화장품/미용',path:['화장품/미용'] },
  '50000003':{ name:'디지털/가전',path:['디지털/가전'] },
  '50000004':{ name:'가구/인테리어',path:['가구/인테리어'] },
  '50000005':{ name:'식품',       path:['식품'] },
  '50000006':{ name:'스포츠/레저',path:['스포츠/레저'] },
  '50000007':{ name:'생활/건강',  path:['생활/건강'] },
  '50000009':{ name:'출산/육아',  path:['출산/육아'] },
  '50000010':{ name:'반려동물',   path:['반려동물'] },
  '50000011':{ name:'자동차용품', path:['자동차용품'] },
};

const DATA_DIR  = path.resolve(__dirname,'../data');
const TOP_N     = Number(argv.topN || 80);
const MAX_PAGES = Math.ceil(TOP_N / 20); // 20개/페이지
const HEADLESS  = argv.headless !== 'false';
const URL       = 'https://datalab.naver.com/shoppingInsight/sCategory.naver';

function log(...a){ console.log(new Date().toISOString(),'-',...a); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function ensureDir(d){ fs.mkdirSync(d,{recursive:true}); }

function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

async function selectByText(selectEl, text){
  const ok = await selectEl.evaluate((sel,t)=>{
    const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
    const want=norm(t);
    const opt=Array.from(sel.options).find(o=>norm(o.textContent)===want||norm(o.value)===want);
    if(!opt) return false;
    sel.value=opt.value;
    sel.dispatchEvent(new Event('input',{bubbles:true}));
    sel.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  },text);
  if(!ok) throw new Error('select 실패: '+text);
}

async function clickByText(page, text, timeout=6000){
  const rx=new RegExp('^\\s*'+escapeRegex(text)+'\\s*$');
  for(const loc of[
    page.getByRole('button',{name:rx}),
    page.getByRole('link',{name:rx}),
    page.getByText(rx),
  ]){
    try{
      if(await loc.count()&&await loc.first().isVisible({timeout:1000})){
        await loc.first().click({timeout});
        return true;
      }
    }catch(_){}
  }
  return false;
}

async function findPanelHandle(page){
  return page.evaluateHandle(()=>{
    function vis(el){
      const s=window.getComputedStyle(el),r=el.getBoundingClientRect();
      return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;
    }
    const cands=[];
    for(const el of document.querySelectorAll('body *')){
      if(!vis(el)) continue;
      const t=(el.innerText||'').trim();
      if(!t) continue;
      if(/TOP\s*500/.test(t)&&t.includes('인기검색어')&&/\b\d+\s*\/\s*25\b/.test(t)&&t.length>100)
        cands.push(el);
    }
    cands.sort((a,b)=>a.innerText.length-b.innerText.length);
    return cands[0]||null;
  }).then(h=>h.asElement());
}

async function parseCurrentPage(page){
  const panel=await findPanelHandle(page);
  if(!panel) throw new Error('패널 없음');
  const text=await panel.innerText();
  const lines=text.split(/\n+/).map(v=>v.replace(/\s+/g,' ').trim()).filter(Boolean);
  const ignore=[/인기검색어/,/TOP\s*500/,/\d{4}\.\d{2}/,/^\d+\s*\/\s*25$/,/조회결과/];
  const cleaned=lines.filter(l=>!ignore.some(rx=>rx.test(l)));
  const items=[];
  for(let i=0;i<cleaned.length-1;i++){
    const a=cleaned[i],b=cleaned[i+1];
    if(/^\d+$/.test(a)){
      const rank=Number(a);
      if(rank>=1&&rank<=20&&b&&!/^\d/.test(b)){
        items.push({localRank:rank,keyword:b});
        i++;
      }
    }
  }
  const pageM=text.match(/(\d+)\s*\/\s*25/);
  return {items:items.slice(0,20),pageNo:pageM?Number(pageM[1]):1,panel};
}

async function clickNext(page, panel, curPage){
  const moved=await panel.evaluate((root,cur)=>{
    function vis(el){
      const s=window.getComputedStyle(el),r=el.getBoundingClientRect();
      return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;
    }
    const rx=new RegExp('^\\s*'+cur+'\\s*/\\s*25\\s*$');
    const all=Array.from(root.querySelectorAll('*')).filter(vis);
    const ind=all.find(el=>rx.test((el.textContent||'').trim()));
    const btns=Array.from(root.querySelectorAll('button,a,[role="button"]')).filter(vis);
    let target=null;
    if(ind){
      const ir=ind.getBoundingClientRect(),ic={x:(ir.left+ir.right)/2,y:(ir.top+ir.bottom)/2};
      const right=btns.map(el=>({el,r:el.getBoundingClientRect()}))
        .filter(x=>{const c={x:(x.r.left+x.r.right)/2,y:(x.r.top+x.r.bottom)/2};return Math.abs(c.y-ic.y)<40&&c.x>ic.x;})
        .sort((a,b)=>a.r.left-b.r.left);
      if(right.length) target=right[right.length-1].el;
    }
    if(!target&&btns.length) target=btns[btns.length-1];
    if(!target) return false;
    target.click(); return true;
  },curPage);
  if(!moved) return false;
  try{
    await page.waitForFunction(n=>{
      return new RegExp('\\b'+n+'\\s*/\\s*25\\b').test(document.body.innerText||'');
    },curPage+1,{timeout:8000});
  }catch(_){ await sleep(1200); }
  return true;
}

async function scrapeCategory(browser, catId, catInfo){
  const page=await browser.newPage();
  page.setDefaultTimeout(30000);
  const results=[];
  const seen=new Set();

  try{
    log('['+catInfo.name+'] 접속');
    await page.goto(URL,{waitUntil:'domcontentloaded'});
    await page.waitForLoadState('networkidle').catch(()=>{});

    // 카테고리 선택
    const sels=page.locator('select');
    await page.waitForSelector('select',{timeout:15000});
    for(let i=0;i<catInfo.path.length;i++){
      await selectByText(sels.nth(i),catInfo.path[i]);
      await sleep(800);
    }

    // 기간: 1개월 일간
    const tuIdx=catInfo.path.length;
    await selectByText(sels.nth(tuIdx),'일간');
    await sleep(400);
    await clickByText(page,'1개월');
    await sleep(800);

    await clickByText(page,'조회하기');
    await page.waitForFunction(()=>{
      const t=document.body.innerText||'';
      return t.includes('인기검색어')&&/TOP\s*500/.test(t);
    },{timeout:30000});
    await sleep(1500);

    for(let p=1;p<=MAX_PAGES;p++){
      const snap=await parseCurrentPage(page);
      const pNo=snap.pageNo||p;
      log('['+catInfo.name+'] 페이지 '+pNo+'/25 items:'+snap.items.length);
      if(seen.has(pNo)){ log('중복 페이지, 중단'); break; }
      seen.add(pNo);
      if(!snap.items.length){ log('파싱 실패'); break; }
      for(const item of snap.items){
        results.push({
          globalRank:(pNo-1)*20+item.localRank,
          keyword:item.keyword,
        });
      }
      if(results.length>=TOP_N) break;
      if(pNo>=25) break;
      const moved=await clickNext(page,snap.panel,pNo);
      if(!moved){ log('다음 페이지 없음'); break; }
      await sleep(1000);
    }
  }finally{
    await page.close();
  }
  return results.slice(0,TOP_N);
}

async function saveSeed(catId, items){
  ensureDir(DATA_DIR);
  const filePath=path.join(DATA_DIR,'seeds-'+catId+'.json');
  const payload={
    catId,
    updatedAt:new Date().toISOString(),
    total:items.length,
    keywords:items.map(i=>i.keyword),
    ranked:items,
  };
  fs.writeFileSync(filePath,JSON.stringify(payload,null,2),'utf8');
  log('저장 완료:',filePath,'('+items.length+'개)');
  return filePath;
}

async function main(){
  ensureDir(DATA_DIR);
  const targets=argv.all==='true'
    ? Object.keys(CAT_MAP)
    : [(argv.catId||'50000000')];

  const browser=await chromium.launch({headless:HEADLESS,slowMo:120});
  try{
    for(const catId of targets){
      const info=CAT_MAP[catId];
      if(!info){ log('알 수 없는 catId:',catId); continue; }
      try{
        const items=await scrapeCategory(browser,catId,info);
        await saveSeed(catId,items);
        log('['+info.name+'] 완료 top5:'+items.slice(0,5).map(i=>i.keyword).join(', '));
      }catch(e){
        log('['+info.name+'] 실패:',e.message);
      }
      if(targets.length>1) await sleep(3000);
    }
  }finally{
    await browser.close();
  }
  log('전체 완료');
}

main();
