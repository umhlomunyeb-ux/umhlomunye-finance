import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { supabase } from "../../lib/supabase";
import { approveLoanTopUp } from "../../services/loanTopUpService";
import MobileBottomNavigation from "../../mobile/components/MobileBottomNavigation";

const money=value=>Number(value||0).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2});
export default function MobileApplicationReviews(){
 const navigate=useNavigate();
 const [applications,setApplications]=useState([]);
 const [topUps,setTopUps]=useState([]);
 const [loading,setLoading]=useState(true);
 const [approvingId,setApprovingId]=useState("");
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");

 async function loadApplications(){
  try{
   setLoading(true);setError("");
   const [appsResult,topUpsResult]=await Promise.all([
    supabase.from("loan_applications").select("*").in("status",["PENDING","UNDER_REVIEW"]).order("created_at",{ascending:false}),
    supabase.from("loan_top_up_requests").select("id,loan_id,customer_id,requested_amount,status,created_at,loans(loan_number,principal_amount,current_balance,total_paid,term_months,customers(first_name,last_name,customer_number))").eq("status","PENDING_APPROVAL").order("created_at",{ascending:false})
   ]);
   if(appsResult.error)throw appsResult.error;
   if(topUpsResult.error)throw topUpsResult.error;
   setApplications(appsResult.data||[]);setTopUps(topUpsResult.data||[]);
  }catch(err){console.error("Unable to load mobile applications:",err);setError(err?.message||"Unable to load applications and top-ups.");}
  finally{setLoading(false);}
 }
 useEffect(()=>{
  loadApplications();
  const channel=supabase.channel("mobile-application-review-list")
   .on("postgres_changes",{event:"*",schema:"public",table:"loan_applications"},loadApplications)
   .on("postgres_changes",{event:"*",schema:"public",table:"loan_top_up_requests"},loadApplications)
   .subscribe();
  return()=>{supabase.removeChannel(channel);};
 },[]);
 async function handleApproveTopUp(request){
  const loanNumber=request.loans?.loan_number||"this loan";
  if(!window.confirm("Approve the R "+money(request.requested_amount)+" top-up for "+loanNumber+"?"))return;
  setApprovingId(request.id);setError("");setSuccess("");
  try{
   const result=await approveLoanTopUp(request.id);
   setSuccess("Top-up approved for "+loanNumber+". New principal: R "+money(result?.principal_amount)+". Monthly instalment: R "+money(result?.monthly_repayment)+" for "+(result?.remaining_term_months||"the remaining")+" month(s). Funding status: "+String(result?.funding_status||"updated").replaceAll("_"," ")+".");
   await loadApplications();
  }catch(err){console.error("Unable to approve top-up:",err);setError(err?.message||"Unable to approve this top-up.");}
  finally{setApprovingId("");}
 }
 const formatDate=value=>value?new Date(value).toLocaleDateString("en-ZA",{year:"numeric",month:"short",day:"numeric"}):"-";
 const formatStatus=value=>(value||"Unknown").replaceAll("_"," ").toLowerCase().replace(/\\b\\w/g,c=>c.toUpperCase());
 const statusColor=value=>value==="PENDING"?"warning":value==="UNDER_REVIEW"?"info":"default";
 return <Box sx={{minHeight:"100vh",backgroundColor:"#f5f6f8",pb:10}}>
  <Box sx={{position:"sticky",top:0,zIndex:20,backgroundColor:"white",borderBottom:"1px solid",borderColor:"divider",px:2,py:1.5}}>
   <Stack direction="row" alignItems="center" spacing={1}><Box sx={{flex:1}}><Typography fontWeight="bold" sx={{fontSize:20}}>Application Review</Typography><Typography variant="caption" color="text.secondary">{applications.length} loan application(s) · {topUps.length} top-up(s) awaiting approval</Typography></Box><Button size="small" variant="outlined" startIcon={<RefreshIcon/>} onClick={loadApplications} disabled={loading}>Refresh</Button></Stack>
  </Box>
  <Box sx={{p:1.5}}>
   {error&&<Alert severity="error" sx={{mb:1.5}} onClose={()=>setError("")}>{error}</Alert>}
   {success&&<Alert severity="success" sx={{mb:1.5}} onClose={()=>setSuccess("")}>{success}</Alert>}
   {loading?<Box sx={{minHeight:"50vh",display:"flex",alignItems:"center",justifyContent:"center"}}><CircularProgress/></Box>:<>
    {topUps.length>0&&<Box sx={{mb:2}}><Typography fontWeight="bold" sx={{mb:1}}>Top-ups awaiting approval</Typography><Stack spacing={1.5}>{topUps.map(request=>{
      const loan=request.loans||{},customer=loan.customers||{};
      const noPayments=Number(loan.total_paid||0)<=0;
      const resultingPrincipal=Number(loan.principal_amount||0)+(noPayments?Number(request.requested_amount||0):0);
      return <Card key={request.id} sx={{border:"2px solid",borderColor:"warning.main",borderRadius:2}}><CardContent><Stack spacing={1.25}>
       <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}><Box sx={{flex:1}}><Typography fontWeight="bold" fontSize={17}>{customer.first_name||""} {customer.last_name||""}</Typography><Typography variant="caption" color="text.secondary">{loan.loan_number||"Loan"} · {customer.customer_number||"Customer"}</Typography></Box><Chip size="small" color="warning" label="Approval required"/></Stack>
       <Divider/>
       <Box sx={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:1.25}}>
        <Box><Typography variant="caption" color="text.secondary">Top-up requested</Typography><Typography fontWeight={800} fontSize={18}>R {money(request.requested_amount)}</Typography></Box>
        <Box><Typography variant="caption" color="text.secondary">Current principal</Typography><Typography fontWeight={700}>R {money(loan.principal_amount)}</Typography></Box>
        <Box><Typography variant="caption" color="text.secondary">Current balance</Typography><Typography fontWeight={700}>R {money(loan.current_balance)}</Typography></Box>
        <Box><Typography variant="caption" color="text.secondary">Payments made</Typography><Typography fontWeight={700}>R {money(loan.total_paid)}</Typography></Box>
        <Box sx={{gridColumn:"1 / -1"}}><Typography variant="caption" color="text.secondary">After approval</Typography><Typography fontWeight={700}>{noPayments?"New principal: R "+money(resultingPrincipal):"Top-up added to outstanding balance: R "+money(Number(loan.current_balance||0)+Number(request.requested_amount||0))}</Typography></Box>
        <Box sx={{gridColumn:"1 / -1"}}><Typography variant="caption" color="text.secondary">Requested</Typography><Typography>{formatDate(request.created_at)}</Typography></Box>
       </Box>
       <Alert severity="info" sx={{py:0}}>The top-up will be added to principal if no payment has been made. Otherwise, it will be added to the outstanding balance.</Alert>
       <Button fullWidth variant="contained" color="success" size="large" sx={{minHeight:52,fontWeight:"bold"}} disabled={Boolean(approvingId)} onClick={()=>handleApproveTopUp(request)}>{approvingId===request.id?"Approving...":"Approve Top-up"}</Button>
      </Stack></Card>;
    })}</Stack></Box>}
    {applications.length>0?<Stack spacing={1.5}><Typography fontWeight="bold">Loan applications awaiting review</Typography>{applications.map(application=><Card key={application.id} sx={{border:"1px solid",borderColor:"divider"}}><CardContent><Stack spacing={1.5}>
     <Stack direction="row" alignItems="flex-start" spacing={1}><Box sx={{flex:1}}><Typography fontWeight="bold" sx={{fontSize:17}}>{application.first_name||""} {application.last_name||""}</Typography><Typography variant="caption" color="text.secondary">{application.application_number||"-"}</Typography></Box><Chip label={formatStatus(application.status)} color={statusColor(application.status)} size="small"/></Stack>
     <Divider/><Stack direction="row" spacing={2}><Box sx={{flex:1}}><Typography variant="caption" color="text.secondary">LOAN REQUEST</Typography><Typography fontWeight="bold" fontSize={19}>R {money(application.amount_requested)}</Typography></Box><Box sx={{flex:1}}><Typography variant="caption" color="text.secondary">SUBMITTED</Typography><Typography>{formatDate(application.created_at)}</Typography></Box></Stack>
     {application.loan_purpose&&<Box><Typography variant="caption" color="text.secondary">PURPOSE</Typography><Typography>{application.loan_purpose}</Typography></Box>}
     <Button fullWidth variant="contained" size="large" onClick={()=>navigate("/mobile/application-review/"+application.id)} sx={{minHeight:52,fontWeight:"bold"}}>Review Application</Button>
    </Stack></CardContent></Card>)}</Stack>:null}
    {applications.length===0&&topUps.length===0&&<Card><CardContent><Typography fontWeight="bold" sx={{mb:1}}>No applications waiting for review</Typography><Typography color="text.secondary">There are currently no pending loan applications or top-up requests.</Typography></CardContent></Card>}
   </>}
  </Box>
  <MobileBottomNavigation/>
 </Box>;
}
