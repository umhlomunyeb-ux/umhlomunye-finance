import { useContext,useEffect,useRef } from "react";
import { BrowserRouter,Routes,Route,Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import ProtectedRoute from "../routes/ProtectedRoute";
import MobileAdminRoute from "../routes/MobileAdminRoute";
import MobileApplicationReviews from "../pages/Applications/MobileApplicationReviews";
import MobileApplicationReview from "../pages/Applications/MobileApplicationReview";
import MobileLanding from "./pages/MobileLanding";
import MobileLogin from "./pages/MobileLogin";
import MobilePreview from "./pages/MobilePreview";
import MobileFundingRequests from "./pages/MobileFundingRequests";
import { AuthContext } from "../context/AuthContext";
import { initializePushNotifications } from "./pushNotifications";
function MobilePushInitializer(){const {user}=useContext(AuthContext);const cleanupRef=useRef(null);useEffect(()=>{let cancelled=false;async function setup(){if(!user?.id)return;if(cleanupRef.current){await cleanupRef.current();cleanupRef.current=null;}const cleanup=await initializePushNotifications(user);if(cancelled){if(cleanup)await cleanup();return;}cleanupRef.current=cleanup;}setup();return()=>{cancelled=true;if(cleanupRef.current){cleanupRef.current();cleanupRef.current=null;}};},[user?.id]);return null;}
function AdminOnly({children}){return <ProtectedRoute><MobileAdminRoute>{children}</MobileAdminRoute></ProtectedRoute>;}
export default function MobileApp(){return <><Toaster position="top-right"/><BrowserRouter><MobilePushInitializer/><Routes>
<Route path="/" element={<Navigate to="/mobile" replace/>}/><Route path="/mobile" element={<MobileLanding/>}/><Route path="/mobile/login" element={<MobileLogin/>}/><Route path="/login" element={<MobileLogin/>}/>
<Route path="/mobile/preview" element={<AdminOnly><MobilePreview/></AdminOnly>}/><Route path="/dashboard" element={<Navigate to="/mobile/preview" replace/>}/>
<Route path="/mobile/application-review" element={<AdminOnly><MobileApplicationReviews/></AdminOnly>}/><Route path="/mobile/application-review/:id" element={<AdminOnly><MobileApplicationReview/></AdminOnly>}/>
<Route path="/mobile/funding-requests" element={<AdminOnly><MobileFundingRequests/></AdminOnly>}/><Route path="*" element={<Navigate to="/mobile" replace/>}/>
</Routes></BrowserRouter></>;}
