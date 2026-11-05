import { useEffect,useState } from "react";
import { useLocation,useNavigate } from "react-router-dom";
import { Paper,BottomNavigation,BottomNavigationAction,Badge } from "@mui/material";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import { supabase } from "../../lib/supabase";

export default function MobileBottomNavigation(){
 const navigate=useNavigate(),location=useLocation();
 const [unreadCount,setUnreadCount]=useState(0);
 const value=location.pathname.startsWith("/mobile/funding-requests")?"funding":location.pathname.startsWith("/mobile/application-review")?"applications":"home";
 useEffect(()=>{
  let active=true;
  const loadUnread=async()=>{
   const {count,error}=await supabase.from("mobile_admin_notifications").select("id",{count:"exact",head:true}).is("read_at",null);
   if(active&&!error)setUnreadCount(count||0);
  };
  loadUnread();
  const channel=supabase.channel("mobile-admin-notification-badge")
   .on("postgres_changes",{event:"*",schema:"public",table:"mobile_admin_notifications"},loadUnread)
   .subscribe();
  return()=>{active=false;supabase.removeChannel(channel);};
 },[]);
 return <Paper elevation={8} sx={{position:"fixed",bottom:0,left:0,right:0,zIndex:100,borderTop:"1px solid",borderColor:"divider"}}><BottomNavigation value={value} onChange={(_,v)=>{if(v==="home")navigate("/mobile/preview");if(v==="applications")navigate("/mobile/application-review");if(v==="funding")navigate("/mobile/funding-requests");}} showLabels sx={{height:62}}><BottomNavigationAction label="Dashboard" value="home" icon={<HomeOutlinedIcon/>}/><BottomNavigationAction label="Applications" value="applications" icon={<DescriptionOutlinedIcon/>}/><BottomNavigationAction label="Funding" value="funding" icon={<Badge badgeContent={unreadCount} color="error"><AccountBalanceWalletOutlinedIcon/></Badge>}/></BottomNavigation></Paper>;
}