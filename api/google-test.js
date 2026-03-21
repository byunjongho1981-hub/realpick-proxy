var https = require('https');

module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');

  var key = process.env.GOOGLE_API_KEY;
  var cx  = process.env.GOOGLE_CX;

  if(!key) return res.status(200).json({ok:false, error:'GOOGLE_API_KEY 없음'});
  if(!cx)  return res.status(200).json({ok:false, error:'GOOGLE_CX 없음'});

  // 가장 단순한 검색 1건
  var path = '/customsearch/v1?key='+key+'&cx='+cx+'&q=무선이어폰&num=1';

  var result = await new Promise(function(resolve){
    var t = setTimeout(function(){resolve({timeout:true});}, 8000);
    https.get({hostname:'www.googleapis.com', path:path}, function(r){
      var raw='';
      r.on('data',function(c){raw+=c;});
      r.on('end',function(){
        clearTimeout(t);
        try{resolve({status:r.statusCode, body:JSON.parse(raw)});}
        catch(e){resolve({status:r.statusCode, raw:raw.slice(0,300)});}
      });
    }).on('error',function(e){clearTimeout(t);resolve({error:e.message});});
  });

  return res.status(200).json({
    ok: result.status===200,
    status: result.status,
    keyPrefix: key.slice(0,8)+'...',
    cx: cx,
    result: result.body||result
  });
};
