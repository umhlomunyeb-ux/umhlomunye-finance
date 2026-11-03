import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "../lib/supabase";
const APP_ID="za.co.umhlomunye.finance",PLATFORM="android";
let notificationListeners=[],initialized=false;
export async function initializePushNotifications(user){
 if(!Capacitor.isNativePlatform()||!user?.id||initialized)return null;initialized=true;
 try{let permission=await PushNotifications.checkPermissions();if(permission.receive!=="granted")permission=await PushNotifications.requestPermissions();if(permission.receive!=="granted"){initialized=false;return null;}
 const registration=await PushNotifications.addListener("registration",async({value})=>{const now=new Date().toISOString();const{error}=await supabase.from("user_push_tokens").upsert({user_id:user.id,token:value,platform:PLATFORM,app_id:APP_ID,is_active:true,last_seen_at:now,updated_at:now},{onConflict:"token"});if(error)console.error("[Push] Token save failed:",error);});notificationListeners.push(registration);
 const registrationError=await PushNotifications.addListener("registrationError",e=>console.error("[Push] Registration error:",e));notificationListeners.push(registrationError);
 const received=await PushNotifications.addListener("pushNotificationReceived",n=>console.log("[Push] Received:",n));notificationListeners.push(received);
 const action=await PushNotifications.addListener("pushNotificationActionPerformed",e=>handleNotificationAction(e));notificationListeners.push(action);
 await PushNotifications.register();return cleanupPushListeners;
 }catch(e){initialized=false;console.error("[Push] Initialization failed:",e);return null;}
}
function handleNotificationAction(action){const data=action?.notification?.data||{};const appId=data.application_id||data.applicationId;const requestId=data.funding_request_id||data.fundingRequestId;if(requestId){window.location.href="/mobile/funding-requests";return;}if(appId)window.location.href=`/mobile/application-review/${appId}`;}
async function cleanupPushListeners(){for(const l of notificationListeners){try{await l.remove();}catch(e){console.warn("[Push] Listener cleanup:",e);}}notificationListeners=[];initialized=false;}
