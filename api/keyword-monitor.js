var https = require('https');
var fs    = require('fs');
var path  = require('path');

function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }

function fmtDate(d){
  var p=function(n){return String(n).padStart(2,'0');};
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}

// ── scraped seeds 읽기 (없으면 null) ─────────────────────────
function loadScrapedSeeds(catId){
  try{
    var fp=path.resolve(process.cwd(),'data','seeds-'+catId+'.json');
    if(!fs.existsSync(fp)) return null;
    var raw=JSON.parse(fs.readFileSync(fp,'utf8'));
    return raw; // { catId, updatedAt, keywords:[], ranked:[] }
  }catch(e){
    console.warn('[monitor] seeds 파일 읽기 실패:',e.message);
    return null;
  }
}

// ── 쇼핑인사이트 surge 계산 ──────────────────────────────────
function fetchSurge(catId, kw, startDate, endDate, timeUnit){
  return new Promise(function(resolve){
    var buf=Buffer.from(JSON.stringify({
      startDate:startDate, endDate:endDate, timeUnit:timeUnit,
      category:catId,
      keyword:[{name:kw, param:[kw]}],
      device:'', gender:'', ages:[],
    }),'utf8');
    var done=false;
    var t=setTimeout(function(){if(!done){done=true;resolve(null);}},6000);
    var req=https.request({
      hostname:'openapi.naver.com',
      path:'/v1/datalab/shopping/category/keywords',
      method:'POST',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        'Content-Type':          'application/json',
        'Content-Length':        buf.length,
      }
    },function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        if(done)return; done=true; clearTimeout(t);
        try{
          var d=JSON.parse(raw);
          if(d.errorCode){ console.error('[surge]',d.errorCode,d.errorMessage); resolve(null); return; }
          resolve(d);
        }catch(e){ resolve(null); }
      });
    });
    req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve(null);}});
    req.setTimeout(5500,function(){req.destroy();});
    req.write(buf); req.end();
  });
}

module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST')    return res.status(405).json({error:'POST only'});

  // seeds 메타 조회 (프론트 상태 표시용)
  if(req.url&&req.url.includes('action=meta')){
    var meta={};
    var cats=['50000000','50000001','50000002','50000003','50000004',
              '50000005','50000006','50000007','50000009','50000010','50000011'];
    cats.forEach(function(id){
      var s=loadScrapedSeeds(id);
      meta[id]=s?{updatedAt:s.updatedAt,total:s.total}:null;
    });
    return res.status(200).json({meta:meta});
  }

  var body='';
  req.on('data',function(c){body+=c;});
  req.on('end', async function(){
    try{
      var p      = JSON.parse(body);
      var catId  = p.catId  || '50000000';
      var period = p.period || 'week';
      var topN   = Math.min(Number(p.topN||20), 80);

      // ① scraped seeds 우선 로드
      var scraped = loadScrapedSeeds(catId);
      var seeds   = scraped ? scraped.keywords.slice(0, topN*2) : [];
      var seedSrc = scraped ? 'scraped('+scraped.total+'개·'+scraped.updatedAt.slice(0,10)+')' : 'none';

      console.log('[monitor] catId:'+catId+' seedSrc:'+seedSrc+' seeds:'+seeds.length);

      if(!seeds.length){
        return res.status(200).json({
          items:[],
          warning:'seeds 파일 없음. scripts/scrape-seeds.js --catId='+catId+' 먼저 실행하세요.',
          seedSource:seedSrc,
        });
      }

      var totalDays = period==='month'?60:14;
      var end   = new Date();
      var start = new Date(); start.setDate(end.getDate()-(totalDays+1));
      var timeUnit = period==='month'?'week':'date';

      // ② surge 계산
      var results=[];
      for(var i=0;i<seeds.length;i++){
        var kw=seeds[i];
        var data=await fetchSurge(catId, kw, fmtDate(start), fmtDate(end), timeUnit);

        if(data&&data.results&&data.results[0]){
          var r   = data.results[0];
          var pts = (r.data||[]).map(function(d){return parseFloat(d.ratio)||0;});
          if(pts.length>=2){
            var h   = Math.floor(pts.length/2);
            var avg = function(a){return a.reduce(function(s,v){return s+v;},0)/(a.length||1);};
            var pa  = avg(pts.slice(0,h));
            var ca  = avg(pts.slice(h));
            var cur = avg(pts.slice(-3));
            var surge = pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?50:0);
            if(cur>0){
              results.push({
                keyword:      kw,
                currentRatio: Math.round(cur*100)/100,
                surge:        surge,
                shopTrend:    surge>=30?'hot':surge>=10?'rising':surge>=-10?'stable':'falling',
              });
            }
          }
        }
        await sleep(150);
      }

      // ③ surge 우선 정렬
      results.sort(function(a,b){
        if(b.surge!==a.surge) return b.surge-a.surge;
        return b.currentRatio-a.currentRatio;
      });

      var top20=results.slice(0,20);
      console.log('[monitor] 완료 결과:'+results.length+' top1:'+(top20[0]&&top20[0].keyword)+' surge:'+(top20[0]&&top20[0].surge)+'%');

      return res.status(200).json({
        items:top20,
        seedSource:seedSrc,
        seedUpdatedAt: scraped?scraped.updatedAt:null,
      });

    }catch(e){
      console.error('[monitor]',e.message);
      return res.status(500).json({error:e.message});
    }
  });
};
