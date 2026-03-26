var https = require('https');

function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }

function fmtDate(d){
  var p=function(n){return String(n).padStart(2,'0');};
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}

// ── Step 1: 인기키워드 랭킹 GET (seeds 불필요) ───────────────
function fetchTopKeywords(catId, startDate, endDate){
  return new Promise(function(resolve){
    var qs=[
      'startDate='+startDate,
      'endDate='+endDate,
      'timeUnit=date',
      'categoryId='+catId,
      'device=',
      'gender=',
      'ages=',
      'count=30',
    ].join('&');
    var done=false;
    var t=setTimeout(function(){if(!done){done=true;resolve([]);}},6000);
    var req=https.request({
      hostname:'openapi.naver.com',
      path:'/v1/datalab/shopping/categories/keywords?'+qs,
      method:'GET',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      }
    },function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        if(done)return; done=true; clearTimeout(t);
        try{
          var d=JSON.parse(raw);
          if(d.errorCode){ console.error('[rank]',d.errorCode,d.errorMessage); resolve([]); return; }
          // [{rank, keyword, linkId, ...}, ...]
          resolve((d.keywords||[]).map(function(k){return k.keyword;}));
        }catch(e){ resolve([]); }
      });
    });
    req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve([]);}});
    req.setTimeout(5500,function(){req.destroy();});
    req.end();
  });
}

// ── Step 2: 키워드별 surge 계산 (기존 로직 유지) ─────────────
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
          if(d.errorCode){ resolve(null); return; }
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

  var body='';
  req.on('data',function(c){body+=c;});
  req.on('end', async function(){
    try{
      var p      = JSON.parse(body);
      var catId  = p.catId  || '50000000';
      var period = p.period || 'week';

      var totalDays = period==='month'?60:14;
      var end   = new Date();
      var start = new Date(); start.setDate(end.getDate()-(totalDays+1));
      var timeUnit = period==='month'?'week':'date';

      // 랭킹 조회 기간은 최근 4일 (인기검색어 API 최소 단위)
      var rankEnd   = fmtDate(end);
      var rankStart = fmtDate(new Date(end.getTime()-3*86400000));

      console.log('[monitor] catId:'+catId+' rankStart:'+rankStart+' rankEnd:'+rankEnd);

      // ① 실시간 TOP 30 키워드 동적 취득
      var seeds = await fetchTopKeywords(catId, rankStart, rankEnd);
      console.log('[monitor] seeds(dynamic):'+seeds.length+' top3:'+seeds.slice(0,3).join(','));

      if(!seeds.length) return res.status(200).json({items:[]});

      var results=[];

      // ② 각 키워드 surge 계산
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
            results.push({
              keyword:      kw,
              currentRatio: Math.round(cur*100)/100,
              surge:        surge,
              shopTrend:    surge>=30?'hot':surge>=10?'rising':surge>=-10?'stable':'falling',
            });
          }
        } else {
          results.push({keyword:kw, currentRatio:0, surge:0, shopTrend:'stable'});
        }
        await sleep(150);
      }

      // ③ surge 기준 정렬 (클릭량 많은 키워드 중 급등순)
      results.sort(function(a,b){
        if(b.surge!==a.surge) return b.surge-a.surge;
        return b.currentRatio-a.currentRatio;
      });

      var top20=results.slice(0,20);
      console.log('[monitor] 완료 top1:'+(top20[0]&&top20[0].keyword)+' surge:'+(top20[0]&&top20[0].surge)+'%');
      return res.status(200).json({items:top20});

    }catch(e){
      console.error('[monitor]',e.message);
      return res.status(500).json({error:e.message});
    }
  });
};
