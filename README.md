# Container Nursery
<p align="center"><img src="https://user-images.githubusercontent.com/2771251/132473388-9f0ff8d9-7bbb-47e5-b45f-9634d86a0dff.png" height="250"></p>

<p align="center">
  <img alt="GitHub package.json version" src="https://img.shields.io/github/package-json/v/ItsEcholot/ContainerNursery">
  <img alt="Maintenance" src="https://img.shields.io/maintenance/yes/2021">
</p>

Written in Node.js, this application acts as a reverse proxy and stops Docker containers which haven't been accessed recently.  
Currently active Websocket connections are also taken into account before stopping the container.

To improve the user experience a loading page is presented, which automatically reloads when the containers webserver is ready.

The application listens on port `80` for traffic.

**This application is a rough draft at its current stage, it may contain all sorts of nasty bugs and the code quality is 'meh' at best. PRs / Bug reports are welcomed.**

## Demo


https://user-images.githubusercontent.com/2771251/132314400-817971fd-b364-4c78-9fed-650138960530.mp4


## Installation
I ***heavily*** recommend running this application in a Docker container. Pull the latest image using:

```docker pull ghcr.io/itsecholot/containernursery:latest```

More information about the available tags and versions can be found on the [GitHub packages page](https://github.com/ItsEcholot/ContainerNursery/pkgs/container/containernursery).

## Configuration
To configure the proxy, edit the `config.yml` file in the `config` directory. The configuration file is automatically reloaded by the application when changes are made.
If no `config.yml` file is found an empty one is automatically created on application start.

The virtual hosts the proxy should handle can be configured by adding an object to the `proxyHosts` key.

The following properties are required:

Property | Meaning
---------|--------|
`domain` | For which domain to listen for (equals the `host` header)
`containerName` | Which container (by name or id) to start and stop
`proxyHost` | Domain / IP of container (use custom Docker bridge networks for dynDNS using the name of the container)
`proxyPort` | Port on which the containers webserver listens on
`timeoutSeconds` | Seconds after which the container should be stopped. The internal timeout gets reset to this configured value every time a new HTTP request is made, or when the timer runs out while a Websocket connection is still active.

### Example Configuration
```yaml
proxyHosts:
  - domain: handbrake.yourdomain.io
    containerName: handbrake
    proxyHost: localhost
    proxyPort: 5800
    timeoutSeconds: 14400
  - domain: whatever.yourdomain.io
    containerName: wordpress
    proxyHost: wordpress
    proxyPort: 3000
    timeoutSeconds: 1800
```

