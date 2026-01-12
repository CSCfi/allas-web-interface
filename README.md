## allas-web-interface

### Notice:
> **⚠️ Notice:** This repository is using a modified version that omits the Encryption & Decryption. The original can be found [in this repo](https://github.com/CSCfi/swift-browser-ui).




### Description

A web frontend for browsing and downloading objects saved in [SWIFT](https://docs.openstack.org/swift/latest/)
compliant object storage, supporting SSO with SAML2 federated authentication.

### Requirements

Python 3.12+ required.

- The dependencies mentioned in `requirements.txt`.
- A suitable storage backend supporting usage via OpenStack Object Storage API. (e.g. Ceph RGW, OpenStack Swift)
- PostgreSQL
- Redis

### Development
To start all required services, you can use the `docker-compose` files from https://github.com/CSCfi/swift-ui-deployment,
or the provided `Procfile`, as shown bellow.

Please, read and adhere to the [CONTRIBUTING guidelines](CONTRIBUTING.md) for submitting changes.

#### Getting started:
```bash
git clone -b devel git@github.com:CSCfi/swift-browser-ui.git
cd swift-browser-ui
```
Install frontend dependencies, and build (without encryption or OIDC enabled).

```bash
pnpm --prefix swift_browser_ui_frontend install
pnpm --prefix swift_browser_ui_frontend run build
```

Install python dependencies, optionally in a virtual environment.

```bash
python3 -m venv venv --prompt swiftui  # Optional step, creates python virtual environment
source venv/bin/activate  # activates virtual environment
pip install -Ue .[docs,test,dev]
pre-commit install
```

Set up the environment variables

```bash
cp .github/config/.env.test .env  # Make any changes you need to the file
```

Open another terminal, and build the `keystone-swift` image

```bash
git clone git@github.com:CSCfi/docker-keystone-swift.git
cd docker-keystone-swift
docker buildx build -t keystone-swift .
```

Start the servers

```bash
honcho start
```

Now you should be able to access the development server at localhost:8081. The login and password are `swift`, and `veryfast`, respectively.

This configuration has both frontend and backend servers running with code reloading features, meaning that after code changes the servers reload.

##### Trusted TLS
Additionally, when testing with the encrypted upload features, browser
features are used that **require** a trusted TLS connection. This can
be achieved by using a development proxy server that can be built from
files in the `devproxy` folder. [The proxy has it's own instructions for building.](devproxy/README.md)

This guide assumes you're using `devenv` as the domain name. Replace this
with the domain you're certificate sings, and if necessary, add it to
`/etc/hosts` so it's resolvable both in docker, and locally.

Additional setup is required in your environment file. You'll need to
configure the following keys to point to whatever hostname will be used
to access the service. Additionally you should allow all hosts, assuming
your machine is in a secure network when developing. In case you trust
your network and want as easy of a setup as possible, you can use all to
greenlight all hosts for access.

```
SWIFT_UI_FRONTEND_ALLOW_HOSTS=devenv
SWIFT_UI_TLS_PORT=8443
SWIFT_UI_TLS_HOST=hostname
```

Additionally you'll need to configure the endpoints to be correct, so that
the backend APIs work as intended.
```
BROWSER_START_SHARING_ENDPOINT_URL=https://devenv:9443
BROWSER_START_SHARING_INT_ENDPOINT_URL=http://localhost:9090
BROWSER_START_REQUEST_ENDPOINT_URL=https://devenv:10443
BROWSER_START_REQUEST_INT_ENDPOINT_URL=http://localhost:9091
BROWSER_START_RUNNER_ENDPOINT=http://localhost:9092
BROWSER_START_RUNNER_EXT_ENDPOINT=https://devenv:11443
```

If your Docker network does not match the default, you'll need to change the
network configuration to make the proxy aware of the backend services. The
environment network defaults to the default Docker network, which is:
```
DOCKER_NETWORK_SEGMENT=172.17.0.0/24
DOCKER_NETWORK_GATEWAY=172.17.0.1
```

If you are using MacOS and Docker Desktop, the network can be defined as:
```
DOCKER_NETWORK_SEGMENT=host.docker.internal
DOCKER_NETWORK_GATEWAY=gateway.docker.internal
```

After this, comment out the commands to run without trusted TLS in the
`Procfile`, and uncomment the commands to run with trusted TLS.

You should now be able to run the service with trusted TLS by running
```bash
honcho start
```

##### OIDC login provider

To run with OIDC support, set the `OIDC_` environment variables in the `.env` file and restart the services. You'll also need to build the frontend again:

    OIDC_ENABLED=True pnpm --prefix swift_browser_ui_frontend run build

CSC OIDC provider's certificate should be added to `certifi`'s certificate store:
```bash
cd swift-browser-ui
source venv/bin/activate

curl -sLo oidc-cert.pem https://crt.sh/?d=2475254782
cert_path=$(python -c "import certifi;print(certifi.where())")
cat oidc-cert.pem >> ${cert_path}
rm oidc-cert.pem
```
### License

``allas-web-interface`` and all it sources are released under *MIT License*.
