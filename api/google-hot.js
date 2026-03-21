module.exports = function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.status(200).json({items:[], total:0, message:'준비 중', updatedAt:new Date().toISOString()});
};
