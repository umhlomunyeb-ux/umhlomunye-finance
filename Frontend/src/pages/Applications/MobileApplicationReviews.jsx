import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { supabase } from "../../lib/supabase";
import { approveLoanTopUp } from "../../services/loanTopUpService";
import MobileBottomNavigation from "../../mobile/components/MobileBottomNavigation";
const money=v=>Number(v||0).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2});
export default function MobileApplicationReviews(){
 const navigate=useNavigate();
 const [applications,setApplications]=useState([]),[topUps,setTopUps]=useState([]),[loading,setLoading]=useState(true),[approvingId,setApprovingId]=useState(""),[error,setError]=useState(""),[success,setSuccess]=useState("");
 async function loadApplications(){
  try{
   setLoading(true);setError("");
   const [a,t]=await Promise.all([
    supabase.from("loan_applications").select("*").in("status",["PENDING","UNDER_REVIEW"]).order("created_at",{ascending:false}),
    supabase.from("loan_top_up_requests").select("id,loan_id,customer_id,requested_amount,status,created_at,loans(loan_number,principal_amount,current_balance,total_paid,term_months,customers(first_name,last_name,customer_number))").eq("status","PENDING_APPROVAL").order("created_at",{ascending:false})
   ]);
   if(a.error)throw a.error;if(t.error)throw t.error;
   setApplications(a.data||[]);setTopUps(t.data||[]);
  }catch(e){console.error(e);setError(e?.message||"Unable to load applications.");}
  finally{setLoading(false);}
 }
 useEffect(()=>{loadApplications();const ch=supabase.channel("mobile-application-review-list").on("postgres_changes",{event:"*",schema:"public",table:"loan_applications"},loadApplications).on("postgres_changes",{event:"*",schema:"public",table:"loan_top_up_requests"},loadApplications).subscribe();return()=>{supabase.removeChannel(ch);};},[]);
 async function approve(r){
  const loan=r.loans?.loan_number||"this loan";
  if(!window.confirm("Approve the R "+money(r.requested_amount)+" top-up for "+loan+"?"))return;
  setApprovingId(r.id);setError("");setSuccess("");
  try{const result=await approveLoanTopUp(r.id);setSuccess("Top-up approved for "+loan+". Principal: R "+money(result?.principal_amount)+". Monthly instalment: R "+money(result?.monthly_repayment)+" for "+result?.remaining_term_months+" month(s). Funding: "+String(result?.funding_status||"updated").replaceAll("_"," ")+".");await loadApplications();}
  catch(e){console.error(e);setError(e?.message||"Unable to approve this top-up.");}
  finally{setApprovingId("");}
 }
 const date=v=>v?new Date(v).toLocaleDateString("en-ZA",{year:"numeric",month:"short",day:"numeric"}):"-";
 const title=v=>(v||"Unknown").replaceAll("_"," ").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
 return <Box sx={{minHeight:"100vh",backgroundColor:"#f5f6f8",pb:10}}>
  <Box sx={{position:"sticky",top:0,zIndex:20,backgroundColor:"white",borderBottom:"1px solid",borderColor:"divider",px:2,py:1.5}}><Stack direction="row" alignItems="center" spacing={1}><Box sx={{flex:1}}><Typography fontWeight="bold" sx={{fontSize:20}}>Application Review</Typography><Typography variant="caption" color="text.secondary">{applications.length} loan application(s) · {topUps.length} top-up(s) awaiting approval</Typography></Box><Button size="small" variant="outlined" startIcon={<RefreshIcon/>} onClick={loadApplications} disabled={loading}>Refresh</Button></Stack></Box>
  <Box sx={{p:1.5}}>
   {error&&<Alert severity="error" sx={{mb:1.5}} onClose={()=>setError("")}>{error}</Alert>}
   {success&&<Alert severity="success" sx={{mb:1.5}} onClose={()=>setSuccess("")}>{success}</Alert>}
   {loading?<Box sx={{minHeight:"50vh",display:"flex",alignItems:"center",justifyContent:"center"}}><CircularProgress/></Box>:<>
    {topUps.length>0&&<Box sx={{mb:2}}><Typography fontWeight="bold" sx={{mb:1}}>Top-ups awaiting approval</Typography><Stack spacing={1.5}>{topUps.map(r=>{
     const l=r.loans||{},c=l.customers||{},noPayment=Number(l.total_paid||0)<=0;
     const principal=Number(l.principal_amount||0)+(noPayment?Number(r.requested_amount||0):0);
     const after=noPayment?"New principal: R "+money(principal):"Top-up added to outstanding balance: R "+money(Number(l.current_balance||0)+Number(r.requested_amount||0));
     return <Card key={r.id} sx={{border:"2px solid",borderColor:"warning.main",borderRadius:2}}><CardContent><Stack spacing={1.25}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}><Box sx={{flex:1}}><Typography fontWeight="bold" fontSize={17}>{c.first_name||""} {c.last_name||""}</Typography><Typography variant="caption" color="text.secondary">{l.loan_number||"Loan"} · {c.customer_number||"Customer"}</Typography></Box><Chip size="small" color="warning" label="Approval required"/></Stack>
      <Divider/>
      <Box sx={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:1.25}}>
       <Box><Typography variant="caption" color="text.secondary">Top-up requested</Typography><Typography fontWeight={800} fontSize={18}>R {money(r.requested_amount)}</Typography></Box>
       <Box><Typography variant="caption" color="text.secondary">Current principal</Typography><Typography fontWeight={700}>R {money(l.principal_amount)}</Typography></Box>
       <Box><Typography variant="caption" color="text.secondary">Current balance</Typography><Typography fontWeight={700}>R {money(l.current_balance)}</Typography></Box>
       <Box><Typography variant="caption" color="text.secondary">Payments made</Typography><Typography fontWeight={700}>R {money(l.total_paid)}</Typography></Box>
       <Box sx={{gridColumn:"1 / -1"}}><Typography variant="caption" color="text.secondary">After approval</Typography><Typography fontWeight={700}>{after}</Typography></Box>
       <Box sx={{gridColumn:"1 / -1"}}><Typography variant="caption" color="text.secondary">Requested</Typography><Typography>{date(r.created_at)}</Typography></Box>
      </Box>
      <Alert severity="info" sx={{py:0}}>If no payment has been made, the top-up is added to principal. Otherwise, it is added to the outstanding balance.</Alert>
      <Button fullWidth variant="contained" color="success" size="large" sx={{minHeight:52,fontWeight:"bold"}} disabled={Boolean(approvingId)} onClick={()=>approve(r)}>{approvingId===r.id?"Approving...":"Approve Top-up"}</Button>
     </Stack></CardContent></Card>;
    })}</Stack></Box>}
    {applications.length>0&&<Stack spacing={1.5}><Typography fontWeight="bold">Loan applications awaiting review</Typography>{applications.map(a=><Card key={a.id}><CardContent><Stack spacing={1.5}><Stack direction="row" alignItems="flex-start" spacing={1}><Box sx={{flex:1}}><Typography fontWeight="bold" sx={{fontSize:17}}>{a.first_name||""} {a.last_name||""}</Typography><Typography variant="caption" color="text.secondary">{a.application_number||"-"}</Typography></Box><Chip label={title(a.status)} size="small"/></Stack><Divider/><Stack direction="row" spacing={2}><Box sx={{flex:1}}><Typography variant="caption" color="text.secondary">LOAN REQUEST</Typography><Typography fontWeight="bold" fontSize={19}>R {money(a.amount_requested)}</Typography></Box><Box sx={{flex:1}}><Typography variant="caption" color="text.secondary">SUBMITTED</Typography><Typography>{date(a.created_at)}</Typography></Box></Stack>{a.loan_purpose&&<Box><Typography variant="caption" color="text.secondary">PURPOSE</Typography><Typography>{a.loan_purpose}</Typography></Box>}<Button fullWidth variant="contained" size="large" onClick={()=>navigate("/mobile/application-review/"+a.id)} sx={{minHeight:52,fontWeight:"bold"}}>Review Application</Button></Stack></CardContent></Card>)}</Stack>}
    {applications.length===0&&topUps.length===0&&<Card><CardContent><Typography fontWeight="bold" sx={{mb:1}}>No applications waiting for review</Typography><Typography color="text.secondary">There are currently no pending loan applications or top-up requests.</Typography></CardContent></Card>}
   </>}
  </Box><MobileBottomNavigation/>
 </Box>;
}
