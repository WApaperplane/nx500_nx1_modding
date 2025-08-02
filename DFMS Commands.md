# DFMS Commands

The commands are sent to dfmsd, which needs to be running, e.g. from the shell: `dfmsd -t &`

Supported operations:
 - send PTP commands
 - start DFMS scripts
 - read, modify and reset adjustment data (DANGEROUS!)

## DFMS Help screen

```
[root@drime5 ~]# dfmstool -h
Usage: dfmstool [OPTION] [CMD]... 

Send factory command. 

Commands: 
    -p|--ptp-normal [CMD]       Send ptp command with normal format. 
                                Ex) dfmstool --ptp-normal "proximity wait in" 
    -P|--ptp-predef [CMD...]    Send ptp command with predef format. 
                                Ex) dfmstool --ptp-predef 0x10030000 1397563418 
    -s|--script [CMD]           Send script command. 
                                Ex) dfmstool --script "proximity wait in" 
    -l|--pmark-list             Print list of process mark IDs. 
    -a|--adj-show               Print all adjust data. 
    -r|--adj-read [ID]          Print given adjust data. [ID] is name of adj-data. 
                                Ex) dfmstool --adj-read GYROSCOPE_DATA_X 
    -R|--adj-read-str [ID]      Print given adjust data with string format. [ID] is name of adj-data. 
                                Ex) dfmstool --adj-read-str WIFI_MAC_ADDR 
    -w|--adj-write [ID] [size] [value] 
                                Write adjust data 
                                [ID] is name of adj-data, [size] is in bytes 
                                Ex) dfmstool --adj-write GYROSCOPE_DATA_X 4 20 
    -d|--adj-default            Save default adjust data. 
    -h|--help                   Show this help screen 

```

## Adjust data

Taken on NX500, most of this is probably physical calibration, so don't mess it up:

```
[root@drime5 ~]# dfmstool -a
------------------------------------------------------------------------------
     PREF                            NAME      SIZE      VALUE 
------------------------------------------------------------------------------
  adj_sys                SHIPPING_COUNTRY         2         36 (0x0024)
  adj_sys             LOCAL_MARKET_AFRICA         1          0 (0x00)
  adj_sys              LOCAL_MARKET_SAUDI         1          0 (0x00)
  adj_sys              ENGINEERING_SAMPLE         4          0 (0x00000000)
  adj_sys                SYSTEM_RESERVED1        16         -- 
  adj_sys                    LANG_DEFAULT         2          3 (0x0003)
  adj_sys                        LANG_SUB         2          3 (0x0003)
  adj_sys                    VOUT_DEFAULT         2          1 (0x0001)
  adj_sys                     QWERTY_TYPE         2          0 (0x0000)
  adj_sys                  QWERTY_DEFAULT         2          1 (0x0001)
  adj_sys                      TILT_INFO1         4          0 (0x00000000)
  adj_sys                      TILT_INFO2         4          0 (0x00000000)
  adj_sys                      TILT_INFO3         4          0 (0x00000000)
  adj_sys                      TILT_INFO4         4          0 (0x00000000)
  adj_sys                      TILT_INFO5         4          0 (0x00000000)
  adj_sys                GYROSCOPE_DATA_X         4          0 (0x00000000)
  adj_sys                GYROSCOPE_DATA_Y         4          0 (0x00000000)
  adj_sys                GYROSCOPE_DATA_Z         4          0 (0x00000000)
  adj_sys                 GYROSCOPE_THERM         4          0 (0x00000000)
  adj_sys             GYROSCOPE_THERM_DSP         4          0 (0x00000000)
  adj_sys                  PRODUCT_NUMBER        16         -- 
  adj_sys                SYSTEM_RESERVED3         4          0 (0x00000000)
  adj_sys                   WIFI_MAC_ADDR        12         -- 
  adj_sys                 WIFI_SERIAL_NUM        16         -- 
  adj_sys            WIFI_INFINITIUM_CERT         1          0 (0x00)
  adj_sys                WIFI_SNS_GATEWAY         2          0 (0x0000)
  adj_sys               WIFI_COUNTRY_CODE         2          0 (0x0000)
  adj_sys            WIFI_COUNTRY_CODE_5G         2      17732 (0x0044)
  adj_sys                 WIFI_COUNTRY_CH         2         13 (0x000d)
  adj_sys           WIFI_COUNTRY_CH_DUMMY         2          0 (0x0000)
  adj_sys                     BT_MAC_ADDR        12         -- 
  adj_sys              TEMP_SENSOR_SELECT         4          4 (0x00000004)
  adj_sys      TEMP_SENSOR_CIS_TH_WARNING         4        106 (0x0000006a)
  adj_sys     TEMP_SENSOR_CIS_TH_CRITICAL         4        110 (0x0000006e)
  adj_sys      TEMP_SENSOR_CPU_TH_WARNING         4        102 (0x00000066)
  adj_sys     TEMP_SENSOR_CPU_TH_CRITICAL         4        105 (0x00000069)
  adj_sys      TEMP_SENSOR_ISP_TH_WARNING         4        106 (0x0000006a)
  adj_sys     TEMP_SENSOR_ISP_TH_CRITICAL         4        110 (0x0000006e)
  adj_sys                SYSTEM_RESERVED4       996         -- 
------------------------------------------------------------------------------

  adj_cap                          CIS_SN         4    7490030 (0xffffffee)
  adj_cap                CIS_CHIP_VERSION         2         10 (0x000a)
  adj_cap                 CIS_CLAMP_LEVEL         2          0 (0x0000)
  adj_cap                 CIS_PIXEL_NUM_B         2          0 (0x0000)
  adj_cap                 CIS_PIXEL_NUM_X         2        180 (0xffffffb4)
  adj_cap                 CIS_PIXEL_NUM_T         2          0 (0x0000)
  adj_cap                 CIS_PIXEL_NUM_L         2         18 (0x0012)
  adj_cap                 CIS_PIXEL_NUM_S         2         30 (0x001e)
  adj_cap                 CIS_PIXEL_NUM_P         2          0 (0x0000)
  adj_cap                  CIS_LOT_NUMBER        32         -- 
  adj_cap           LENS_MOUNT_PIN_STATUS         2          0 (0x0000)
  adj_cap                       SS_OFFSET         2        -61 (0xffffffc3)
  adj_cap                          SS_AVR         2          0 (0x0000)
  adj_cap                          SS_VAR         2          0 (0x0000)
  adj_cap                         SS_MURA         2          0 (0x0000)
  adj_cap                      EFS_OFFSET         4     157259 (0x0000004b)
  adj_cap                      EFS_COEFF1         4         97 (0x00000061)
  adj_cap                      EFS_COEFF2         4        363 (0x0000006b)
  adj_cap                      EFS_COEFF3         4        865 (0x00000061)
  adj_cap                 CIS_PIXEL_NUM_O         2          0 (0x0000)
  adj_cap                 CIS_PIXEL_NUM_W         2          0 (0x0000)
  adj_cap                 CIS_PIXEL_NUM_C         2          0 (0x0000)
------------------------------------------------------------------------------

   adj_iq                LIVE_ISO_GAIN_X1         4         21 (0x00000015)
   adj_iq                LIVE_ISO_GAIN_X2         4         33 (0x00000021)
   adj_iq                LIVE_ISO_GAIN_X4         4         38 (0x00000026)
   adj_iq                LIVE_ISO_GAIN_X8         4         44 (0x0000002c)
   adj_iq               LIVE_ISO_GAIN_X16         4         46 (0x0000002e)
   adj_iq               LIVE_ISO_GAIN_X32         4          0 (0x00000000)
   adj_iq                CAPT_ISO_GAIN_X1         4         28 (0x0000001c)
   adj_iq                CAPT_ISO_GAIN_X2         4         36 (0x00000024)
   adj_iq                CAPT_ISO_GAIN_X4         4         40 (0x00000028)
   adj_iq                CAPT_ISO_GAIN_X8         4         40 (0x00000028)
   adj_iq               CAPT_ISO_GAIN_X16         4         43 (0x0000002b)
   adj_iq               CAPT_ISO_GAIN_X32         4          0 (0x00000000)
   adj_iq                        ISO_FLAG         4        170 (0xffffffaa)
   adj_iq                     ISO_VERSION         4        257 (0x00000001)
   adj_iq                  AWB_LOW_GAIN_R         2       3385 (0x0039)
   adj_iq                  AWB_LOW_GAIN_G         2       4096 (0x0000)
   adj_iq                  AWB_LOW_GAIN_B         2       1449 (0xffffffa9)
   adj_iq                 AWB_HIGH_GAIN_R         2          0 (0x0000)
   adj_iq                 AWB_HIGH_GAIN_G         2          0 (0x0000)
   adj_iq                 AWB_HIGH_GAIN_B         2          0 (0x0000)
   adj_iq               AWB_STROBE_GAIN_R         2          0 (0x0000)
   adj_iq               AWB_STROBE_GAIN_G         2          0 (0x0000)
   adj_iq               AWB_STROBE_GAIN_B         2          0 (0x0000)
   adj_iq                        AWB_FLAG         4          1 (0x00000001)
   adj_iq                     AWB_VERSION         4          0 (0x00000000)
   adj_iq                   AF_FOCUS_FLAG         4          1 (0x00000001)
   adj_iq          AF_PUNT_FOCUS_POSITION         4       1146 (0x0000007a)
   adj_iq                    PAF_MISALIGN        50         -- 
   adj_iq                      AF_VERSION         4          0 (0x00000000)
   adj_iq                    PAF_OFFSET_H         4          0 (0x00000000)
   adj_iq                    PAF_OFFSET_V         4          0 (0x00000000)
------------------------------------------------------------------------------

 adj_vfpn         VFPN_LIVE_HD_TABLE_SIZE         2          0 (0x0000)
 adj_vfpn          VFPN_LIVE_HD_TABLE_MIN         4          0 (0x00000000)
 adj_vfpn          VFPN_LIVE_HD_TABLE_MAX         4          0 (0x00000000)
 adj_vfpn          VFPN_LIVE_HD_TABLE_AVG         4          0 (0x00000000)
 adj_vfpn     VFPN_LIVE_FULLHD_TABLE_SIZE         2          0 (0x0000)
 adj_vfpn      VFPN_LIVE_FULLHD_TABLE_MIN         4          0 (0x00000000)
 adj_vfpn      VFPN_LIVE_FULLHD_TABLE_MAX         4          0 (0x00000000)
 adj_vfpn      VFPN_LIVE_FULLHD_TABLE_AVG         4          0 (0x00000000)
 adj_vfpn         VFPN_LIVE_UD_TABLE_SIZE         2          0 (0x0000)
 adj_vfpn          VFPN_LIVE_UD_TABLE_MIN         4          0 (0x00000000)
 adj_vfpn          VFPN_LIVE_UD_TABLE_MAX         4          0 (0x00000000)
 adj_vfpn          VFPN_LIVE_UD_TABLE_AVG         4          0 (0x00000000)
 adj_vfpn            VFPN_CAPT_TABLE_DATA     13400         -- 
 adj_vfpn            VFPN_CAPT_TABLE_SIZE         2      12992 (0xffffffc0)
 adj_vfpn             VFPN_CAPT_TABLE_MIN         4       2030 (0xffffffee)
 adj_vfpn             VFPN_CAPT_TABLE_MAX         4       2044 (0xfffffffc)
 adj_vfpn             VFPN_CAPT_TABLE_AVG         4       2052 (0x00000004)
 adj_vfpn           VFPN_CAPT_HTABLE_DATA      9000         -- 
 adj_vfpn           VFPN_CAPT_HTABLE_SIZE         2       8672 (0xffffffe0)
 adj_vfpn            VFPN_CAPT_HTABLE_MIN         4       2031 (0xffffffef)
 adj_vfpn            VFPN_CAPT_HTABLE_MAX         4       2045 (0xfffffffd)
 adj_vfpn            VFPN_CAPT_HTABLE_AVG         4       2063 (0x0000000f)
------------------------------------------------------------------------------

   adj_cs                         CS_ADDR     56320         -- 
   adj_cs                  CS_TABLE_COUNT        64         -- 
   adj_cs                         CS_FLAG         4          1 (0x00000001)
   adj_cs                      CS_VERSION         4        256 (0x00000000)
------------------------------------------------------------------------------

  adj_dpc                 DPC_HEADER_DATA       492         -- 
  adj_dpc                  DPC_HEADER_NUM         4        148 (0xffffff94)
  adj_dpc                 DPC_PRESET_DATA      8412         -- 
  adj_dpc                  DPC_PRESET_NUM         4        228 (0xffffffe4)
  adj_dpc                    DPC_LV1_DATA     59996         -- 
  adj_dpc                     DPC_LV1_NUM         4          0 (0x00000000)
  adj_dpc                    DPC_LV2_DATA    549996         -- 
  adj_dpc                     DPC_LV2_NUM         4          0 (0x00000000)
  adj_dpc                    DPC_LV3_DATA   1799996         -- 
  adj_dpc                     DPC_LV3_NUM         4          0 (0x00000000)
  adj_dpc                 DPC_4K_LV1_DATA     12996         -- 
  adj_dpc                  DPC_4K_LV1_NUM         4          0 (0x00000000)
  adj_dpc                     DPC_4K_DATA    161996         -- 
  adj_dpc                      DPC_4K_NUM         4          0 (0x00000000)
  adj_dpc                 DPC_UD_LV1_DATA     12996         -- 
  adj_dpc                  DPC_UD_LV1_NUM         4          0 (0x00000000)
  adj_dpc                 DPC_UD_LV2_DATA    151996         -- 
  adj_dpc                  DPC_UD_LV2_NUM         4          0 (0x00000000)
  adj_dpc                     DPC_UD_DATA    139996         -- 
  adj_dpc                      DPC_UD_NUM         4          0 (0x00000000)
  adj_dpc                    DPC_FHD_DATA    129996         -- 
  adj_dpc                     DPC_FHD_NUM         4          0 (0x00000000)
  adj_dpc                    DPC_FAF_DATA    199996         -- 
  adj_dpc                     DPC_FAF_NUM         4          0 (0x00000000)
  adj_dpc                   DPC_VFAF_DATA     99996         -- 
  adj_dpc                    DPC_VFAF_NUM         4          0 (0x00000000)
  adj_dpc                    DPC_DMF_DATA    609996         -- 
  adj_dpc                     DPC_DMF_NUM         4          0 (0x00000000)
  adj_dpc               DPC_LIVEFULL_DATA    399996         -- 
  adj_dpc                DPC_LIVEFULL_NUM         4          0 (0x00000000)
  adj_dpc           DPC_NEW_LIVEVIEW_DATA    129996         -- 
  adj_dpc            DPC_NEW_LIVEVIEW_NUM         4          0 (0x00000000)
  adj_dpc                    DPC_LV4_DATA    530000         -- 
  adj_dpc                     DPC_LV4_NUM         4          0 (0x00000000)
------------------------------------------------------------------------------

 adj_dpc2                DPC2_HEADER_DATA   1048572         -- 
 adj_dpc2                 DPC2_HEADER_NUM         4          0 (0x00000000)
------------------------------------------------------------------------------

[root@drime5 ~]# dfmstool -R PRODUCT_NUMBER
89490020****
[root@drime5 ~]# dfmstool -R WIFI_SERIAL_NUM
[root@drime5 ~]# dfmstool -R WIFI_MAC_ADDR
A021959D****
```

## Process Mark IDs (production QS?)

```
[root@drime5 ~]# dfmstool -l
    N: No-test, E: Error, P: Pass 
---------------------------------
                Name    Value 
---------------------------------
          STEP_LABEL    U 
            SNAPSHOT    N 
                 KEY    P 
               POPUP    N 
                JOG1    P 
                JOG2    P 
               WHEEL    N 
           MODE_DIAL    P 
          DRIVE_DIAL    N 
                HDMI    N 
         EXT_RELEASE    N 
             EARJACK    N 
                 USB    P 
           PROXIMITY    N 
                 NFC    P 
              SWIVEL    N 
            ROTATION    P 
                 RTC    P 
       BATTERY_LEVEL    P 
               TOUCH    P 
                  DR    P 
    SHIPMENT_COUNTRY    P 
                WIFI    P 
                 ISO    P 
                 AWB    P 
        DEFECT_PIXEL    P 
                VFPN    P 
             HOTSHOE    P 
                 MOT    N 
                DUST    P 
               NOISE    P 
               MOVIE    P 
         ACCELOMETER    P 
                 PAF    P 
                 EFS    P 
           GYROSCOPE    N 
              STROBE    N 
          FLANGEBACK    P 
             CAPTURE    P 
                 XSW    P 
             SHUTTER    N 
            CIS_DATA    P 
       SHUTTER_SPEED    P 
          LENS_MOUNT    P 
            LOOPBACK    N 
                 LCD    P 
             SPEAKER    P 
                 PBA    P 
           BLUETOOTH    P 
     SHUTTER_HORIZON    P 
       COLOR_SHADING    P 
               VGRIP    N 
               STLCD    N 
                 EVF    N 
              SDCARD    P 
                TILT    N 
          IMG_SENSOR    N 
               AFLED    P 
                 MIC    P 
          CUR_CHARGE    P 
     CUR_CONSUMPTION    P 
         CUR_LEAKAGE    N 
         MAC_ADDRESS    P 
            FUNC_LED    P 
      FWVERSION_BODY    P 
     FWVERSION_MICOM    N 
            ADJ_DATA    N 
                  MR    P 
          USB_CHARGE    N 
      DEFECT_PIXEL_2    P 
```
