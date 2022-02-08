Changelog
=========
**08.02.2021 - v1.6.0** Added the ability to add multiple domains that point to the same proxy host.

**29.11.2021 - v1.5.2** Fixed a bug where misformed docker event payload would crash ContainerNursery when trying to parse JSON. Thanks to Alfy1080 on the Unraid Forums for the Bug report.

**12.10.2021 - v1.5.1** Fixed a bug where the loading page wouldn't be displayed when a path other than `/` is requested. Thanks to @JamesDAdams on GitHub for the Bug report.

**29.09.2021 - v1.5.0** Added the ability to stop (and start) multiple containers per proxy host. This is useful if the application supports multiple containers. The first container in the list is the main container, which is used to check if the container is ready and reload the loading page. For usage information check the README.md file on GitHub.
 
**24.09.2021 - v1.4.2** Handle SIGTERM. The ContainerNursery container should now stop (and thus also restart) much quicker.
 
**23.09.2021 - v1.4.1** Fixed an issue where certain editors broke the live config reload functionality by introducing a small delay before reading the config file.
 
**23.09.2021 - v1.4.0** Added stopOnTimeoutIfCpuUsageBelow setting to proxyHosts which prevents ContainerNursery from stoping containers if they're still busy (using more CPU than the limit). For usage information check the README.md file on GitHub.