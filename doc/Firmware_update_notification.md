# Firmware update notification

The camera will try to obtain the latest firmware version when connecting to
WiFi. It is fetching an XML document from www.samsungimaging.com under
`/common/support/firmware/downloadUrlList.do` with query parameters
`prd_mdl_name` for the model name (e.g. "SAMSUNG NX1") and `loc` for the
region.

On success, the new version will be stored in the prefman block 0
`APPPREF_WIFI_NEW_FW_VERSION` field (up to 32 bytes of UTF-8), and the drawer
menu will change its color from white to light green.

In the drawer menu, there will also be a "New Firmware" button in the top
right, showing the new firmware version and allowing to download it.

## NX1

Firmware info is in prefman block 0:

```
 0x00005ce5    0001    APPPREF_FIRMNOTI_OK 
 0x00005ce6    0001    APPPREF_FIRMNOTI_NOTSHOW 
 ...
 0x0000746c    0032    APPPREF_WIFI_NEW_FW_VERSION 
```

Show/hide the button in drawer menu:

```
# show
prefman set 0 0x00005ce6 b 1

# hide
prefman set 0 0x00005ce6 b 0
```

Version string dump:

```
[root@drime5 ~]# prefman get 0 0x0000746c v=32
[app] in memory: 

[0000746c]  36 2e 36 36 00 00 00 00 00 00 00 00 00 00 00 00  
[0000747c]  00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00  
```
The above byte array decodes to "6.66"

The string is a 32-byte UTF-8, allowing for Unicode characters and at least ☺
as a smiley.

Set a subversive message (call the command, then paste the hex numbers, press
Enter, press Ctrl+D):

```
[root@drime5 ~]# prefman set 0 0x0000746c v=32
Enter value in hex format without '0x'. (e.g. 00 0a 1a 2b) 
e2 98 ba 20 48 65 6c 6c 6f 20 57 6f 72 6c 64 21 20 e2 98 ba
^D
```
