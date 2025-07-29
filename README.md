# Bull Queue Exporter
**Prometheus exporter for Bull metrics.**

<p align="right">
  <a href="https://travis-ci.org/UpHabit/bull_exporter/branches/">
    <img src="https://travis-ci.org/UpHabit/bull-prom-metrics.svg?branch=master"/>
  </a>
  <br/>
</p>
<p align="center">
  <a href="https://prometheus.io/">
    <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Prometheus_software_logo.svg/115px-Prometheus_software_logo.svg.png" height="115">
  </a>
  <a href="https://github.com/OptimalBits/bull">
    <img src="https://github.com/OptimalBits/bull/blob/develop/support/logo@2x.png" height="115" />
  </a>
</p>

___


## UI
![Grafana Dashboard](./docs/img/grafana-1.png)

## Setup
#### Prometheus
**An existing prometheus server is required to use this project**

To learn more about how to setup promethues and grafana see: https://eksworkshop.com/monitoring/

#### Grafana
The dashboard pictured above is [available to download from grafana](https://grafana.com/grafana/dashboards/10128).
It will work aslong as EXPORTER_STAT_PREFIX is not changed.

## Queue Discovery
Queues are discovered at start up by running `KEYS bull:*:id`
this can also be triggered manually from the `/discover_queues` endpoint
`curl -XPOST localhost:9538/discover_queues`

## Metrics

| Metric                       | type    | description                                             |
|------------------------------|---------|---------------------------------------------------------|
| bull_queue_completed         | counter | Total number of completed jobs                          |
| bull_queue_complete_duration | summary | Processing time for completed jobs                      |
| bull_queue_active            | counter | Total number of active jobs (currently being processed) |
| bull_queue_delayed           | counter | Total number of jobs that will run in the future        |
| bull_queue_failed            | counter | Total number of failed jobs                             |
| bull_queue_waiting           | counter | Total number of jobs waiting to be processed            |
| bull_queue_prioritized       | counter | Total number of prioritized jobs                        |

## Kubernetes Usage

### Required Environment Variables

| variable                    | description                                     |
|-----------------------------|-------------------------------------------------|
| EXPORTER_SENTINEL_HOSTS     | Comma-separated list of Sentinel hosts         |
| EXPORTER_SENTINEL_NAME      | Master name configured in Sentinel              |

### Optional Environment Variables

| variable                    | default                  | description                                     |
|-----------------------------|--------------------------|-------------------------------------------------|
| EXPORTER_SENTINEL_PASSWORD  | -                        | Password for Sentinel authentication            |
| EXPORTER_PREFIX             | bull                     | prefix for queues                               |
| EXPORTER_STAT_PREFIX        | bull_queue_              | prefix for exported metrics                     |
| EXPORTER_QUEUES             | -                        | a space separated list of queues to check       |
| EXPORTER_AUTODISCOVER       | -                        | set to '0' or 'false' to disable queue discovery|

### Example deployment

see: [k8s-sample.yaml](./docs/k8s-sample.yaml) for more options

```yaml
apiVersion: apps/v1

kind: Deployment
metadata:
  name: bull-exporter
  labels:
    app: bull
    role: exporter

spec:
  selector:
    matchLabels:
      app: bull
      role: exporter
  replicas: 1
  template:
    metadata:
      labels:
        app: bull
        role: exporter
    spec:
      containers:
        - name: bull-exporter
          image: uphabit/bull_exporter:latest
          securityContext:
            runAsGroup: 65534 # nobody
            runAsUser: 65534 # nobody
            runAsNonRoot: true
            privileged: false
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - all
          resources:
            requests:
              cpu: 100m
              memory: 128M
            limits:
              cpu: 200m
              memory: 512M
          env:
              # space delimited list of queues
            - name: EXPORTER_QUEUES
              value: "mail job_one video audio"

              # Required Sentinel configuration
            - name: EXPORTER_SENTINEL_HOSTS
              value: "sentinel-1:26379,sentinel-2:26379,sentinel-3:26379"
            - name: EXPORTER_SENTINEL_NAME
              value: "mymaster"
            - name: EXPORTER_SENTINEL_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: redis-sentinel-secret
                  key: password
---
apiVersion: v1
kind: Service
metadata:
  name: bull-exporter
  labels:
    app: bull
    role: exporter
  annotations:
    prometheus.io/scrape: 'true'
    prometheus.io/port: '9538'
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 9538
      targetPort: 9538
  selector:
    app: bull
    role: exporter
```
