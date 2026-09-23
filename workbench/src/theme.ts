import {createTheme} from "@mui/material/styles";
/** Established ModelForge graphite UI, implemented as one shared MUI theme. */
export const workbenchTheme = createTheme({
 palette:{mode:"dark",primary:{main:"#76b900",contrastText:"#111a05"},secondary:{main:"#38bdf8"},background:{default:"#07090b",paper:"#0d1014"},text:{primary:"#f1f3f6",secondary:"#858d99"},divider:"#252a31",success:{main:"#45c47a"},warning:{main:"#e4a84d"},error:{main:"#ef6b73"}},
 typography:{fontFamily:'Inter, "SF Pro Text", "Segoe UI", system-ui, -apple-system, sans-serif',fontSize:13,button:{textTransform:"none",fontWeight:600,fontSize:11}},
 shape:{borderRadius:6},spacing:4,
 components:{
  MuiCssBaseline:{styleOverrides:{body:{backgroundColor:"#07090b",fontSize:13},"button:focus-visible, a:focus-visible, input:focus-visible":{outline:"2px solid #a0d951",outlineOffset:1}}},
  MuiButtonBase:{defaultProps:{disableRipple:true}},
  MuiButton:{defaultProps:{size:"small",disableElevation:true,color:"inherit"},styleOverrides:{root:{minWidth:0,textTransform:"none",lineHeight:1.4},outlined:{borderColor:"#343a44"}}},
  MuiIconButton:{defaultProps:{size:"small"},styleOverrides:{root:{borderRadius:4,color:"#858d99"}}},
  MuiTextField:{defaultProps:{size:"small",variant:"outlined"}},
  MuiInputBase:{styleOverrides:{root:{fontSize:11},input:{padding:"7px 9px"}}},
  MuiOutlinedInput:{styleOverrides:{root:{backgroundColor:"#080b0e"},notchedOutline:{borderColor:"#252a31"}}},
  MuiPaper:{defaultProps:{elevation:0},styleOverrides:{root:{backgroundImage:"none"}}},
  MuiTabs:{styleOverrides:{root:{minHeight:32},indicator:{height:1}}},
  MuiTab:{defaultProps:{disableRipple:true},styleOverrides:{root:{minHeight:32,minWidth:0,padding:"0 9px",fontSize:10,textTransform:"none"}}},
  MuiCheckbox:{defaultProps:{size:"small"},styleOverrides:{root:{padding:3}}},
  MuiTooltip:{defaultProps:{arrow:true,enterDelay:500},styleOverrides:{tooltip:{fontSize:10,backgroundColor:"#252a31"}}},
  MuiTableCell:{styleOverrides:{root:{fontSize:11,borderColor:"#252a31",padding:"10px 12px"},head:{fontSize:9,textTransform:"uppercase",color:"#858d99"}}},
  MuiDialog:{styleOverrides:{paper:{border:"1px solid #343a44",backgroundImage:"none"}}},
 },
});
