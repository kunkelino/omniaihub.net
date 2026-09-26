// One From Now private moderator API.
// This file is separate from ofn.html and does not modify the public site.
const BIN=process.env.JSONBIN_BIN_ID;
const KEY=process.env.JSONBIN_KEY;
const ADMIN=process.env.OFN_ADMIN_CODE;
const BIN_URL=BIN?`https://api.jsonbin.io/v3/b/${BIN}`:null;

function send(res,c,o){
  res.statusCode=c;
  res.setHeader("Content-Type","application/json");
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  res.end(JSON.stringify(o));
}
function headers(){return {"Content-Type":"application/json","X-Master-Key":KEY,"X-Bin-Meta":"false"};}
function body(req){return typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});}
async function read(){
  if(!BIN_URL||!KEY) throw new Error("JSONBin is not configured for this project");
  const r=await fetch(BIN_URL+"/latest",{headers:headers(),cache:"no-store"});
  if(!r.ok) throw new Error("Could not read the shared OFN data");
  const d=await r.json();
  const x=d.record||d;
  return {
    info:Array.isArray(x.info)?x.info:[],
    story:Array.isArray(x.story)?x.story:[],
    rooms:x.rooms&&typeof x.rooms==="object"&&!Array.isArray(x.rooms)?x.rooms:{},
    resources:Array.isArray(x.resources)?x.resources:[],
    videos:Array.isArray(x.videos)?x.videos:[],
    modQueue:Array.isArray(x.modQueue)?x.modQueue:[],
    suggestions:Array.isArray(x.suggestions)?x.suggestions:[]
  };
}
async function write(s){
  const r=await fetch(BIN_URL,{method:"PUT",headers:headers(),body:JSON.stringify(s)});
  if(!r.ok) throw new Error("Could not save the shared OFN data");
}
function ok(req){
  const b=body(req);
  return !!ADMIN && String(b.code||"")===String(ADMIN);
}
module.exports=async function(req,res){
  if(req.method==="OPTIONS") return send(res,204,{});
  try{
    const b=body(req);
    if(b.action==="login"){
      if(!ADMIN) return send(res,503,{ok:false,error:"OFN_ADMIN_CODE is not configured"});
      return send(res,ok(req)?200:401,{ok:ok(req),error:ok(req)?undefined:"Wrong moderator code"});
    }
    if(!ok(req)) return send(res,401,{error:"Not authorized"});
    let s=await read();
    if(b.action==="get") return send(res,200,s);
    if(b.action==="deleteInfo"||b.action==="deleteStory"){
      const key=b.action==="deleteStory"?"story":"info";
      s[key]=s[key].filter(x=>String(x.id)!==String(b.id));
    } else if(b.action==="deleteResource"){
      s.resources=s.resources.filter(x=>String(x.id)!==String(b.id));
    } else if(b.action==="deleteVideo"){
      s.videos=s.videos.filter(x=>String(x.id)!==String(b.id));
    } else if(b.action==="deleteSuggestion"){
      s.suggestions=s.suggestions.filter(x=>String(x.id||x.at)!==String(b.id));
    } else if(b.action==="queue"){
      const id=String(b.id), item=s.modQueue.find(x=>String(x.id)===id);
      s.modQueue=s.modQueue.filter(x=>String(x.id)!==id);
      if(b.decision==="keep"&&item&&item.room){
        const rows=Array.isArray(s.rooms[item.room])?s.rooms[item.room]:[];
        if(!rows.some(x=>String(x.id)===id)) rows.push({id:item.id,who:item.who,text:item.text,at:item.at});
        s.rooms[item.room]=rows;
      }
    } else if(b.action==="addResource"){
      s.resources.unshift({...b.resource,id:"admin-"+Date.now()});
    } else if(b.action==="addVideo"){
      s.videos.unshift({...b.video,id:"admin-"+Date.now()});
    } else return send(res,400,{error:"Unknown action"});
    await write(s); return send(res,200,s);
  }catch(e){return send(res,500,{error:e.message||String(e)})}
};