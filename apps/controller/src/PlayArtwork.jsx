import React, {useEffect, useMemo, useRef, useState} from 'react';
import {AccessibilityInfo, Animated, Image, StyleSheet, View} from 'react-native';

/** One bounded response to an actual input/contact, never an idle swing loop. */
export function PlayArtwork({sport, source, event, active}) {
  const movement = useRef(new Animated.Value(0)).current;
  const consumed = useRef(null);
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let live=true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {if(live)setReduced(value);}).catch(()=>{});
    const subscription=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);
    return () => {live=false;subscription.remove();};
  }, []);
  useEffect(() => {
    movement.stopAnimation(); movement.setValue(0);
    const fresh = event && event.id !== consumed.current;
    consumed.current = event?.id;
    // Returning from pause, Tools or Reduce Motion never replays an old swing.
    if (!active || reduced || !fresh) return;
    const animation=Animated.timing(movement,{toValue:1,duration:event.type==='roll' ? 650 : 420,useNativeDriver:true});
    animation.start();
    return () => animation.stop();
  }, [event,active,reduced,movement]);
  const roll=sport==='bowling' && event?.type==='roll';
  const backhand=/backhand/i.test(event?.label || '');
  const transform=useMemo(()=>[
    {translateY:movement.interpolate({inputRange:[0,.75,1],outputRange:roll ? [0,-55,0] : [0,-5,0]})},
    {rotate:movement.interpolate({inputRange:[0,.25,.7,1],outputRange:roll ? ['0deg','40deg','190deg','0deg']
      : event?.type==='hit' ? ['0deg','-6deg','6deg','0deg'] : backhand ? ['0deg','22deg','-32deg','0deg'] : ['0deg','-22deg','32deg','0deg']})},
    {scale:movement.interpolate({inputRange:[0,.35,.75,1],outputRange:roll ? [1,.8,.45,1] : [1,1.08,1.03,1]})},
  ],[movement,roll,backhand,event?.type]);
  return <View style={styles.stage} accessible={false}>
    <View style={styles.halo}/>
    <Animated.View style={{transform}}>
      {roll ? <View style={styles.ball}><View style={[styles.hole,{left:36,top:24}]}/><View style={[styles.hole,{left:57,top:34}]}/><View style={[styles.hole,{left:36,top:48}]}/></View>
        : <Image source={source} style={styles.art} resizeMode="contain"/>}
    </Animated.View>
  </View>;
}
const styles=StyleSheet.create({
  stage:{height:180,alignItems:'center',justifyContent:'center',overflow:'hidden'},
  halo:{position:'absolute',width:160,height:160,borderRadius:80,backgroundColor:'#a6e8cf0a',borderWidth:1,borderColor:'#a6e8cf1a'},
  art:{width:126,height:126},ball:{width:96,height:96,borderRadius:48,backgroundColor:'#a6e8cf'},
  hole:{position:'absolute',width:12,height:12,borderRadius:6,backgroundColor:'#183c3c'},
});
