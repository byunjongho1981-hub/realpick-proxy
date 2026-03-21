var INTENT_SUFFIXES = {
  buy:     ['추천','순위','best','구매','싸게','가격'],
  compare: ['비교','차이','vs','어떤게좋아','추천비교'],
  review:  ['후기','리뷰','사용법','사용후기','솔직후기'],
  solve:   ['효과','부작용','원인','방법','해결'],
  season:  ['어버이날','크리스마스','여름','겨울','환절기','선물세트']
};

var INTENT_LABEL  = {buy:'🛒 구매형', compare:'🔄 비교형', review:'📝 후기형', solve:'💡 문제해결형', season:'🎁 시즌형', none:'–'};
var INTENT_ACTION = {buy:'shorts', compare:'blog', review:'blog', solve:'blog', season:'shorts', none:'compare'};

function detectIntent(kw){
  var k=kw.toLowerCase(), types=Object.keys(INTENT_SUFFIXES);
  for(var i=0;i<types.length;i++){
    var s=INTENT_SUFFIXES[types[i]];
    for(var j=0;j<s.length;j++){ if(k.indexOf(s[j])>-1) return types[i]; }
  }
  return 'none';
}

function expandIntentKeywords(baseKw){
  var list=[{kw:baseKw, intent:'none'}], types=Object.keys(INTENT_SUFFIXES);
  for(var i=0;i<types.length;i++) list.push({kw:baseKw+' '+INTENT_SUFFIXES[types[i]][0], intent:types[i]});
  return list;
}

function makeSummary(name, score, trend, intent){
  var action;
  if(intent&&intent!=='none') action=INTENT_ACTION[intent];
  else if(trend.status==='rising'&&score.grade==='A') action='shorts';
  else if(trend.status==='rising'||score.grade==='A') action='blog';
  else if(trend.status==='falling') action='hold';
  else if(score.grade==='B') action='blog';
  else action='compare';
  var lbl={rising:'🔥 급상승', stable:'➡️ 보합', falling:'📉 하락', new:'✨ 신규'};
  var iTxt=(intent&&intent!=='none')?' · '+(INTENT_LABEL[intent]||''):'';
  var note=score.confidence==='low'?' (데이터 부족)':'';
  return {
    summary: name+' '+(lbl[trend.status]||'')+iTxt+' · '+score.totalScore+'점 · '+action.toUpperCase()+' 추천'+note,
    action:  action
  };
}

function buildReason(kw, score, trend, velocity, intent){
  var r=[];
  if(trend.status==='rising')      r.push('검색량 급증 중');
  else if(trend.status==='stable') r.push('검색량 안정적 유지');
  if(velocity){
    if(velocity.surgeRate>=50)       r.push('최근 50%+ 급상승');
    else if(velocity.surgeRate>=20)  r.push('최근 20%+ 상승 중');
    if(velocity.accel>=20)           r.push('상승 가속도 높음');
    if(velocity.durability>=70)      r.push('장기 유지력 강함');
    else if(velocity.durability<40)  r.push('단기 급등형 (빠른 제작 필요)');
  }
  if(score.breakdown.shopping>=30)      r.push('쇼핑 연계 강함');
  else if(score.breakdown.shopping>=15) r.push('쇼핑 데이터 존재');
  if(score.breakdown.blog>=25) r.push('다수 판매처 경쟁 중');
  if(intent==='buy')     r.push('구매 의도 키워드 포함');
  else if(intent==='compare') r.push('비교 탐색 수요 높음');
  else if(intent==='review')  r.push('후기 수요 활발');
  else if(intent==='season')  r.push('시즌성 수요 감지');
  else if(intent==='solve')   r.push('문제 해결형 수요');
  if(score.grade==='A'&&score.confidence==='high') r.push('고신뢰 A등급');
  if(!r.length) r.push('데이터 부족으로 추가 관찰 필요');
  return r.slice(0,3).join(' · ');
}

function clusterCandidates(candidates){
  var clusters={}, order=[];
  candidates.forEach(function(c){
    var name=c.name||'';
    var tokens=name.split(/\s+/).filter(function(t){return t.length>=2;});
    var root=tokens[0]||name;
    var matched=null;
    for(var i=0;i<order.length;i++){
      var k=order[i];
      if(root.indexOf(k)===0||k.indexOf(root)===0){matched=k;break;}
    }
    if(!matched){
      clusters[root]={root:root, representative:c, members:[c], totalCount:c.totalCount||0, maxScore:c.score.totalScore};
      order.push(root);
    } else {
      clusters[matched].members.push(c);
      clusters[matched].totalCount+=(c.totalCount||0);
      if(c.score.totalScore>clusters[matched].maxScore){
        clusters[matched].maxScore=c.score.totalScore;
        clusters[matched].representative=c;
      }
    }
  });
  return order.map(function(k){
    var cl=clusters[k];
    return {root:cl.root, representative:cl.representative, members:cl.members, memberCount:cl.members.length, totalCount:cl.totalCount, maxScore:cl.maxScore};
  }).sort(function(a,b){return b.memberCount-a.memberCount||b.maxScore-a.maxScore;});
}

module.exports = {detectIntent:detectIntent, expandIntentKeywords:expandIntentKeywords, makeSummary:makeSummary, buildReason:buildReason, clusterCandidates:clusterCandidates, INTENT_LABEL:INTENT_LABEL, INTENT_ACTION:INTENT_ACTION};
