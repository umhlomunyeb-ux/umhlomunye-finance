import { useCallback,useEffect,useMemo,useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert,Box,Button,Card,CardContent,CircularProgress,Stack,Typography } from "@mui/material";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import PaymentsIcon from "@mui/icons-material/Payments";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import ScheduleIcon from "@mui/icons-material/Schedule";
import LogoutIcon from "@mui/icons-material/Logout";
import { supabase } from "../../lib/supabase";
import { getCurrentUserProfile } from "../../services/userService";
import { getSystemSettings } from "../../services/settingsService";
import { signOut } from "../../services/authService";
import MobileBottomNavigation from "../components/MobileBottomNavigation";
const money=v=>`R${Number(v||0).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
function Tile({title,value,subtitle,icon,onClick}){return <Card onClick={onClick} sx={{height:"100%",borderRadius:3,cursor:onClick?"pointer":"default",border:"1px solid",borderColor:"divider"}}><CardContent sx={{p:2}}><Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}><Box sx={{minWidth:0}}><Typography color="text.secondary" variant="body2">{title}</Typography><Typography variant="h5" fontWeight={800} sx={{mt:1,overflowWrap:"anywhere"}}>{value}</Typography><Typography color="text.secondary" variant="caption">{subtitle}</Typography></Box><Box sx={{bgcolor:"action.hover",borderRadius:2,p:1,display:"flex"}}>{icon}</Box></Stack></CardContent></Card>}
export default function MobilePreview(){
 const navigate=useNavigate();const [loans,setLoans]=useState([]),[transactions,setTransactions]=useState([]),[applications,setApplications]=useState([]),[funding,setFunding]=useState([]);
 const [userName,setUserName]=useState("Administrator"),[company,setCompany]=useState("Umhlomunye Finance"),[logo,setLogo]=useState("");
 const [loading,setLoading]=useState(true),[error,setError]=useState("");
 const load=useCallback(async()=>{try{setError("");const results=await Promise.all([
 supabase.from("loans").select("id,principal_amount,current_balance,total_paid,interest_amount,loan_status,is_deleted,created_at").eq("is_deleted",false).order("created_at",{ascending:false}),
 supabase.from("loan_transactions").select("transaction_type,credit,interest_paid").order("transaction_date",{ascending:false}).limit(50),
 supabase.from("loan_applications").select("id").eq("status","PENDING"),
 supabase.from("investor_funding_requests").select("id,status").eq("status","REQUESTED")
 ]);for(const r of results)if(r.error)throw r.error;setLoans(results[0].data||[]);setTransactions(results[1].data||[]);setApplications(results[2].data||[]);setFunding(results[3].data||[]);}catch(e){console.error("Mobile dashboard:",e);setError(e?.message||"Unable to load dashboard tiles.");}finally{setLoading(false);}},[]);
 useEffect(()=>{let active=true;Promise.all([getCurrentUserProfile(),getSystemSettings()]).then(([p,s])=>{if(!active)return;setUserName(p?.full_name?.trim()||p?.username||"Administrator");setCompany(s?.company_name||"Umhlomunye Finance");setLogo(s?.company_logo_url||"");}).catch(e=>console.error("Mobile dashboard header:",e));load();const ch=supabase.channel("mobile-lms-dashboard").on("postgres_changes",{event:"*",schema:"public",table:"loans"},load).on("postgres_changes",{event:"*",schema:"public",table:"loan_transactions"},load).on("postgres_changes",{event:"*",schema:"public",table:"loan_applications"},load).on("postgres_changes",{event:"*",schema:"public",table:"investor_funding_requests"},load).subscribe();const timer=setInterval(load,30000);return()=>{active=false;clearInterval(timer);supabase.removeChannel(ch);};},[load]);
 const active=useMemo(()=>loans.filter(l=>String(l.loan_status||"").toLowerCase()==="active"&&!l.is_deleted),[loans]);
 const totalDisbursed=useMemo(()=>loans.reduce((s,l)=>s+Number(l.principal_amount||0),0),[loans]);
 const balance=useMemo(()=>active.reduce((s,l)=>s+Number(l.current_balance||0),0),[active]);
 const paid=useMemo(()=>loans.reduce((s,l)=>s+Number(l.total_paid||0),0),[loans]);
 const interest=useMemo(()=>loans.reduce((s,l)=>s+Number(l.interest_amount||0),0),[loans]);
 const paymentTransactions=useMemo(()=>transactions.filter(t=>String(t.transaction_type||"").toLowerCase()==="payment"),[transactions]);
 const repaymentsReceived=useMemo(()=>paymentTransactions.reduce((s,t)=>s+Number(t.credit||0),0),[paymentTransactions]);
 const interestCollected=useMemo(()=>paymentTransactions.reduce((s,t)=>s+Number(t.interest_paid||0),0),[paymentTransactions]);
 async function logout(){const {error}=await signOut();if(error)setError(error.message||"Unable to log out.");else navigate("/mobile/login",{replace:true});}
 if(loading)return <Box sx={{minHeight:"100dvh",display:"grid",placeItems:"center"}}><CircularProgress/></Box>;
 return <Box sx={{minHeight:"100dvh",bgcolor:"#f4f6f8",pb:10}}><Box sx={{bgcolor:"#102a43",color:"white",px:2,py:2.5,borderBottomLeftRadius:22,borderBottomRightRadius:22}}><Stack direction="row" alignItems="center" spacing={1.5}>{logo?<Box component="img" src={logo} alt={company} sx={{width:48,height:48,objectFit:"contain",bgcolor:"white",borderRadius:2,p:.5}}/>:<AccountBalanceWalletIcon sx={{fontSize:42}}/>}<Box sx={{flex:1,minWidth:0}}><Typography fontWeight={800} fontSize={18}>{company}</Typography><Typography variant="caption" sx={{opacity:.8}}>Welcome, {userName}</Typography></Box><Button color="inherit" variant="outlined" size="small" startIcon={<LogoutIcon/>} onClick={logout}>Log out</Button></Stack></Box><Box sx={{maxWidth:760,mx:"auto",p:2}}><Typography variant="h5" fontWeight={800} sx={{mb:2,color:"#102a43"}}>Dashboard</Typography>{error&&<Alert severity="error" sx={{mb:2}}>{error}</Alert>}<Box sx={{display:"grid",gridTemplateColumns:{xs:"1fr 1fr",sm:"repeat(2,1fr)"},gap:1.5}}>
 <Tile title="Total Loans" value={loans.length} subtitle="All recorded loans" icon={<AccountBalanceWalletIcon/>}/>
 <Tile title="Portfolio Balance" value={money(balance)} subtitle="Outstanding active balance" icon={<TrendingUpIcon/>}/>
 <Tile title="Total Paid" value={money(paid)} subtitle="All recorded repayments" icon={<PaymentsIcon/>}/>
 <Tile title="Pending Applications" value={applications.length} subtitle="Applications awaiting review" icon={<ScheduleIcon/>} onClick={()=>navigate("/mobile/application-review")}/>
 <Tile title="Total Principal Disbursed" value={money(totalDisbursed)} subtitle="Total principal issued" icon={<AccountBalanceWalletIcon/>}/>
 <Tile title="Contracted Interest" value={money(interest)} subtitle="Total interest on recorded loans" icon={<TrendingUpIcon/>}/>
 <Tile title="Repayments Received" value={money(repaymentsReceived)} subtitle="Payments received from borrowers" icon={<PaymentsIcon/>}/>
 <Tile title="Interest Collected" value={money(interestCollected)} subtitle="Payments allocated to accrued interest first" icon={<TrendingUpIcon/>}/>
 <Tile title="Pending Funding Requests" value={funding.length} subtitle="Awaiting investor funds" icon={<AccountBalanceWalletIcon/>} onClick={()=>navigate("/mobile/funding-requests")}/>
 </Box><Button fullWidth variant="contained" sx={{mt:2.5,minHeight:50}} onClick={()=>navigate("/mobile/application-review")}>Open Application Reviews</Button><Button fullWidth variant="outlined" sx={{mt:1.25,minHeight:50}} onClick={()=>navigate("/mobile/funding-requests")}>Open Funding Requests</Button></Box><MobileBottomNavigation/></Box>;
}