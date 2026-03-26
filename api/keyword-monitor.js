var https = require('https');
var CFG   = require('./_trend-config');

function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }

function naverPost(body){
  return new Promise(function(resolve){
    try{
      var buf=Buffer.from(JSON.stringify(body),'utf8');
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
            if(d.errorCode){
              console.error('[insight]',d.errorCode,d.errorMessage);
              resolve(null); return;
            }
            resolve(d);
          }catch(e){resolve(null);}
        });
      });
      req.on('error',function(e){if(!done){done=true;clearTimeout(t);resolve(null);}});
      req.setTimeout(5500,function(){req.destroy();});
      req.write(buf); req.end();
    }catch(e){resolve(null);}
  });
}

function fmtDate(d){
  var p=function(n){return String(n).padStart(2,'0');};
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
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
      var seeds  = (CFG.CATEGORY_SEEDS && CFG.CATEGORY_SEEDS[catId]) || [];

      console.log('[monitor] catId:'+catId+' seeds:'+seeds.length);
      if(!seeds.length) return res.status(200).json({items:[]});

      var totalDays = period==='month'?60:14;
      var end   = new Date();
      var start = new Date(); start.setDate(end.getDate()-(totalDays+1));
      var timeUnit = period==='month'?'week':'date';

      var results=[];

      // ★ 1개씩 순차 호출
      for(var i=0;i<seeds.length;i++){
        var kw=seeds[i];
        var data=await naverPost({
          startDate: fmtDate(start),
          endDate:   fmtDate(end),
          timeUnit:  timeUnit,
          category:  catId,
          keyword:   [{name:kw, param:[kw]}],
          device:'', gender:'', ages:[],
        });

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
            console.log('[monitor] '+kw+' ratio:'+cur.toFixed(2)+' surge:'+surge+'%');
          }
        } else {
          console.warn('[monitor] null: '+kw);
          results.push({keyword:kw, currentRatio:0, surge:0, shopTrend:'stable'});
        }
        await sleep(150);
      }

      results.sort(function(a,b){return b.currentRatio-a.currentRatio;});
      var top20=results.slice(0,20);
      console.log('[monitor] 완료 top1:'+(top20[0]&&top20[0].keyword));
      return res.status(200).json({items:top20});

    }catch(e){
      console.error('[monitor]',e.message);
      return res.status(500).json({error:e.message});
    }
  });
};
