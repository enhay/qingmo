import {mount,unmount,flushSync} from 'svelte';
import App from './App.svelte';
export function createView(options){
 let app;
 flushSync(()=>{app=mount(App,{target:options.container,props:{options}});});
 return {flushDraft:()=>app.flushDraft(),compose:(...args)=>app.compose(...args),refresh:()=>app.refresh(),keyboardChanged:()=>app.keyboardChanged(),handleBack:()=>app.handleBack(),releaseComposer:()=>app.releaseComposer(),setTheme:value=>app.setTheme(value),destroy(){app.beforeDestroy();unmount(app);}};
}
