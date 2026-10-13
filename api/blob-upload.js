const {handleUpload}=require("@vercel/blob/client");
const crypto=require("crypto");
function validTicket(ticket){
  if(!process.env.STORE_ADMIN_PASSWORD||typeof ticket!=="string")return false;
  const parts=ticket.split(".");if(parts.length!==3)return false;
  const timestamp=Number(parts[0]),nonce=parts[1],signature=parts[2];
  if(!Number.isFinite(timestamp)||Math.abs(Date.now()/1000-timestamp)>300||!/^[a-f0-9]{24}$/.test(nonce))return false;
  const expected=crypto.createHmac("sha256",process.env.STORE_ADMIN_PASSWORD).update("media-upload|"+timestamp+"|"+nonce).digest("hex");
  try{return crypto.timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(expected,"hex"))}catch{return false}
}
module.exports=async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  try{
    const result=await handleUpload({
      body:req.body,
      request:req,
      onBeforeGenerateToken:async(pathname,clientPayload)=>{
        if(!validTicket(clientPayload))throw new Error("Upload authorization expired. Sign in and try again.");
        const safeName=String(pathname||"upload").split("/").pop().replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120)||"upload";
        return {
          allowedContentTypes:["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime"],
          maximumSizeInBytes:209715200,
          addRandomSuffix:true,
          tokenPayload:JSON.stringify({fileName:safeName})
        };
      }
    });
    return res.status(200).json(result);
  }catch(error){console.error("Media upload token error:",error);return res.status(400).json({error:error.message||"Media upload failed"})}
};
