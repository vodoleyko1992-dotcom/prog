'use strict';
const E=require('../../engine-core.js');
module.exports=(now=Date.now())=>{
 const day=E.dailyDay(now);let reset=now+3600000;while(E.dailyDay(reset)===day)reset+=3600000;reset=new Date(reset).setUTCMinutes(0,0,0);
 const ids=['hunt_start_500','strong_enemy_20','raid_boss_participate','skill_master_50','daily_playtime_2h','chat_social_10','damage_dealer_500k','fishing_catch_50'];
 return {clock:{serverNowMs:now,timeZone:'Europe/Kyiv',gameDayKey:day.replaceAll('-',''),nextDailyResetAt:reset},daily:{dayKey:day.replaceAll('-',''),tasks:Object.fromEntries(ids.map(id=>[id,{score:0,have:0,need:500,done:false,claimed:false}]))}};
};
