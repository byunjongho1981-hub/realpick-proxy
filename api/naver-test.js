var https = require('https');

function naverGet(path, params){
  return new Promise(function(resolve){
    var qs=Object.keys(params).map(function(k){
      return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);
    }).join('&');
    var start=Date.now();
    var done=false;
    var t=setTimeout(function(){
      if(!done){done=true; resolve({status:'timeout',ms:Date.now()-start,path:path});}
    },8000);
    var req=https.request({
      hostname:'openapi.naver.com', path:path+'?'+qs, method:'GET',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      }
    },function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        if(done) return; done=true; clearTimeout(t);
        try{
          var d=JSON.parse(raw);
          resolve({
            status: d.errorCode ? 'api_error' : 'ok',
            httpStatus: res.statusCode,
            errorCode: d.errorCode||null,
            errorMessage: d.errorMessage||null,
            total: d.total||null,
            count: d.items ? d.items.length : null,
            ms: Date.now()-start,
            path: path,
          });
        }catch(e){
          resolve({status:'parse_error',raw:raw.slice(0,200),ms:Date.now()-start,path:path});
        }
      });
    });
    req.on('error',function(e){
      if(!done){done=true;clearTimeout(t);resolve({status:'req_error',error:e.message,ms:Date.now()-start,path:path});}
    });
    req.setTimeout(7000,function(){req.destroy();});
    req.end();
  });
}

function naverPost(path, body){
  return new Promise(function(resolve){
    var buf=Buffer.from(JSON.stringify(body),'utf8');
    var start=Date.now();
    var done=false;
    var t=setTimeout(function(){
      if(!done){done=true; resolve({status:'timeout',ms:Date.now()-start,path:path});}
    },8000);
    var req=https.request({
      hostname:'openapi.naver.com', path:path, method:'POST',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        'Content-Type':'application/json',
        'Content-Length':buf.length,
      }
    },function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        if(done) return; done=true; clearTimeout(t);
        try{
          var d=JSON.parse(raw);
          resolve({
            status: d.errorCode ? 'api_error' : 'ok',
            httpStatus: res.statusCode,
            errorCode: d.errorCode||null,
            errorMessage: d.errorMessage||null,
            resultCount: d.results ? d.results.length : null,
            ms: Date.now()-start,
            path: path,
          });
        }catch(e){
          resolve({status:'parse_error',raw:raw.slice(0,200),ms:Date.now()-start,path:path});
        }
      });
    });
    req.on('error',function(e){
      if(!done){done=true;clearTimeout(t);resolve({status:'req_error',error:e.message,ms:Date.now()-start,path:path});}
    });
    req.setTimeout(7000,function(){req.destroy();});
    req.write(buf); req.end();
  });
}

module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS') return res.status(200).end();

  var kw = (req.query&&req.query.kw)||'수납박스';
  var now = new Date().toISOString();
  var d=new Date(), pad=function(n){return String(n).padStart(2,'0');};
  var start=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()-14);
  var end  =d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()-1);

  // 5개 API 병렬 테스트
  var results = await Promise.all([
    // 1. 블로그 검색
    naverGet('/v1/search/blog.json', {query:kw, display:3, sort:'date'}),
    // 2. 쇼핑 검색
    naverGet('/v1/search/shop.json', {query:kw, display:3, sort:'sim'}),
    // 3. 뉴스 검색
    naverGet('/v1/search/news.json', {query:kw, display:3, sort:'date'}),
    // 4. 데이터랩 검색어트렌드
    naverPost('/v1/datalab/search', {
      startDate:start, endDate:end, timeUnit:'date',
      keywordGroups:[{groupName:kw, keywords:[kw]}],
    }),
    // 5. 쇼핑인사이트
    naverPost('/v1/datalab/shopping/category/keywords', {
      startDate:start, endDate:end, timeUnit:'date',
      category:'50000007',
      keyword:[{name:kw, param:[kw]}],
      device:'', gender:'', ages:[],
    }),
  ]);

  return res.status(200).json({
    테스트시각: now,
    키워드: kw,
    CLIENT_ID_SET: !!process.env.NAVER_CLIENT_ID,
    CLIENT_SECRET_SET: !!process.env.NAVER_CLIENT_SECRET,
    결과: {
      '블로그검색':       results[0],
      '쇼핑검색':         results[1],
      '뉴스검색':         results[2],
      '데이터랩검색어':   results[3],
      '쇼핑인사이트':     results[4],
    }
  });
};
