// AIORI-3 Hackathon — problem statements and evaluation rubric.
// "scope" texts are concise working summaries derived from the problem titles.
// Organisers may replace them with the official problem descriptions; the AI
// evaluator uses them as the reference for alignment and deliverable checks.

export const DOMAINS = [
  '6G & Future Networks',
  'Cloud Computing & IoT',
  'Cybersecurity',
  'Internet Measurement',
  'Smart Cities',
];

export const PROBLEM_STATEMENTS = [
  // ---------------- 6G & Future Networks ----------------
  {
    id: 'PS-016', domain: '6G & Future Networks',
    title: 'Simulation-Based Handover Decision Evaluation for High-Mobility Users',
    scope: 'Model high-mobility users (vehicular / high-speed rail) in a network simulator and compare handover decision strategies (e.g. A3 offset + hysteresis + time-to-trigger baselines versus predictive or learning-based policies) using metrics such as handover failure rate, ping-pong rate, radio-link failure, interruption time and throughput.',
    keywords: ['handover', 'hand-over', 'ns-3', 'ns3', 'omnet', 'simu5g', 'mobility', 'velocity', 'rsrp', 'rsrq', 'sinr', 'time-to-trigger', 'ttt', 'hysteresis', 'ping-pong', 'pingpong', 'gnb', 'enodeb', 'radio link failure', 'rlf', 'high-speed'],
  },
  {
    id: 'PS-017', domain: '6G & Future Networks',
    title: 'Tail-Latency Prediction for URLLC-Like Traffic in Simulation',
    scope: 'Generate URLLC-like traffic in simulation, collect per-packet latency, and build a model that predicts tail latency (p99 / p99.9 / deadline-violation probability) from observable network state, validated against held-out simulated scenarios with documented error metrics.',
    keywords: ['urllc', 'tail latency', 'p99', 'p99.9', '99th percentile', 'percentile', 'quantile', 'latency', 'jitter', 'deadline', 'reliability', 'queue', 'simulation', 'prediction', 'xgboost', 'lstm', 'regression'],
  },
  {
    id: 'PS-018', domain: '6G & Future Networks',
    title: 'HAPS Link-Quality Prediction Using a Documented Channel Model',
    scope: 'Predict link quality (path loss, SNR/SINR, outage, capacity) for High-Altitude Platform Station links using a documented, citable channel model (e.g. ITU-R P-series, 3GPP TR 38.811 NTN), with clearly stated assumptions, parameters and validation of predictions.',
    keywords: ['haps', 'high-altitude', 'stratospheric', 'elevation angle', 'path loss', 'pathloss', 'itu-r', 'p.618', 'p.676', '38.811', '38.821', 'ntn', 'non-terrestrial', 'rain attenuation', 'link budget', 'snr', 'channel model', 'fading'],
  },
  {
    id: 'PS-020', domain: '6G & Future Networks',
    title: 'Local SRv6 Path Steering and Measured Failure Recovery',
    scope: 'Build a local SRv6 lab (Linux seg6, FRR, Mininet or containerlab) that steers traffic along explicit segment lists, injects link/node failures, and measures recovery behaviour (packet loss, recovery time, path change) with reproducible scripts.',
    keywords: ['srv6', 'segment routing', 'seg6', 'seg6local', 'srh', 'sid', 'segment list', 'frr', 'frrouting', 'mininet', 'containerlab', 'ip -6 route', 'encap', 'failover', 'ti-lfa', 'convergence', 'recovery time'],
  },
  {
    id: 'PS-021', domain: '6G & Future Networks',
    title: 'Experimental Dialog Correlation and Recovery Across Agent Adapters',
    scope: 'Prototype correlation of multi-step dialogs/sessions as they pass across different agent adapters or protocols (e.g. MCP, A2A, HTTP/WebSocket bridges), propagate correlation identifiers, and demonstrate recovery (resume, retry, idempotency) after disconnects or adapter failures, with experiments.',
    keywords: ['dialog', 'dialogue', 'correlation id', 'correlation', 'session', 'conversation id', 'agent', 'adapter', 'a2a', 'mcp', 'model context protocol', 'recovery', 'resume', 'retry', 'idempotency', 'trace id', 'opentelemetry'],
  },
  {
    id: 'PS-026', domain: '6G & Future Networks',
    title: 'AT URI Syntax Compatibility and Round-Trip Validator',
    scope: 'Implement a validator for AT Protocol URIs (at://authority/collection/rkey) covering DID and handle authorities, NSIDs and record keys; test parse → serialise round-trips and compatibility across existing implementations with a conformance/fuzz test corpus.',
    keywords: ['at://', 'at uri', 'aturi', 'atproto', 'at protocol', 'bluesky', 'did:plc', 'did:web', 'handle', 'nsid', 'rkey', 'record key', 'collection', 'round-trip', 'roundtrip', 'validator', 'fuzz', 'conformance'],
  },

  // ---------------- Cloud Computing & IoT ----------------
  {
    id: 'PS-004', domain: 'Cloud Computing & IoT',
    title: 'Authenticated Gateway-Assisted DNSSEC for IoT Clients',
    scope: 'Let constrained IoT clients benefit from DNSSEC by offloading validation to a gateway while keeping the client–gateway channel authenticated (e.g. DTLS/TLS/OSCORE/DoT/DoH), with evaluation of security properties, overhead and failure behaviour.',
    keywords: ['dnssec', 'rrsig', 'dnskey', 'nsec', 'validation', 'validating resolver', 'ad bit', 'iot', 'gateway', 'coap', 'dtls', 'oscore', 'doh', 'dot', 'edns', 'unbound', 'ldns', 'getdns', 'constrained'],
  },
  {
    id: 'PS-007', domain: 'Cloud Computing & IoT',
    title: 'Privacy-Aware IPv6 IoT Security Monitoring Across Address Rotation',
    scope: 'Monitor IoT devices on IPv6 networks for security anomalies even when devices rotate temporary/privacy addresses (RFC 8981), correlating behaviour without exposing stable identifiers, with privacy safeguards and evaluation on captured or simulated traffic.',
    keywords: ['ipv6', 'privacy extension', 'rfc 8981', 'rfc 4941', 'temporary address', 'address rotation', 'slaac', 'interface identifier', 'iid', 'iot', 'anomaly', 'pcap', 'zeek', 'suricata', 'pseudonym', 'hmac', 'monitoring'],
  },
  {
    id: 'PS-023', domain: 'Cloud Computing & IoT',
    title: 'Minimal Two-Node Cloud Hypervisor VM Controller',
    scope: 'Build a minimal controller that manages VM lifecycle (create, boot, stop, delete, optionally migrate) across two hypervisor nodes (e.g. Cloud Hypervisor / KVM), exposing an API, tracking state, and demonstrating placement and failure handling.',
    keywords: ['cloud hypervisor', 'cloud-hypervisor', 'ch-remote', 'kvm', 'qemu', 'libvirt', 'firecracker', 'vmm', 'virtual machine', 'vm lifecycle', 'controller', 'node agent', 'scheduler', 'placement', 'migration', 'tap device'],
  },
  {
    id: 'PS-033', domain: 'Cloud Computing & IoT',
    title: 'DNS-Based Discovery of Diagnostic Services',
    scope: 'Use DNS (DNS-SD PTR/SRV/TXT, SVCB/HTTPS records or mDNS) to advertise and discover network diagnostic services (e.g. measurement/test endpoints), with a client that resolves, validates and uses discovered services.',
    keywords: ['dns-sd', 'dnssd', 'service discovery', 'srv record', 'txt record', 'ptr', 'svcb', 'https record', 'mdns', 'avahi', 'zeroconf', 'rfc 6763', 'rfc 9460', 'diagnostic', 'zone file'],
  },
  {
    id: 'PS-034', domain: 'Cloud Computing & IoT',
    title: 'Schema-Validated YANG-Push Telemetry Pipeline',
    scope: 'Build a telemetry pipeline that subscribes to YANG-Push (RFC 8641) or equivalent model-driven telemetry, validates every notification against the YANG schema, and stores/forwards valid data while reporting schema violations.',
    keywords: ['yang', 'yang-push', 'rfc 8641', 'netconf', 'restconf', 'gnmi', 'subscription', 'pyang', 'libyang', 'yangson', 'schema validation', 'telemetry', 'collector', 'kafka', 'ietf-interfaces', 'notification'],
  },

  // ---------------- Cybersecurity ----------------
  {
    id: 'PS-001', domain: 'Cybersecurity',
    title: 'Android Ransomware-Like Activity Early Warning in a Controlled Lab',
    scope: 'Detect early indicators of ransomware-like behaviour on Android (mass file modification, entropy increase, suspicious permissions/accessibility abuse) in a controlled lab using benign simulators, raising timely alerts with measured detection latency and false-positive rates.',
    keywords: ['android', 'apk', 'ransomware', 'entropy', 'fileobserver', 'accessibility', 'permission', 'adb', 'emulator', 'logcat', 'early warning', 'encryption', 'kotlin', 'behaviour', 'behavior', 'detection'],
  },
  {
    id: 'PS-002', domain: 'Cybersecurity',
    title: 'Purpose-Based Consent Recording and Withdrawal Prototype',
    scope: 'Record purpose-specific consent from data principals, enforce processing only for consented purposes, and support verifiable withdrawal with tamper-evident audit logs, aligned with DPDP Act 2023 style requirements.',
    keywords: ['consent', 'purpose', 'withdrawal', 'revocation', 'dpdp', 'gdpr', 'data principal', 'data fiduciary', 'consent manager', 'consent artefact', 'audit log', 'tamper', 'hash chain', 'notice'],
  },
  {
    id: 'PS-005', domain: 'Cybersecurity',
    title: 'Explainable BGP Origin and Subprefix Anomaly Monitor',
    scope: 'Monitor BGP feeds (RIPE RIS, RouteViews, BGPStream) for origin changes, MOAS and sub-prefix announcements, and produce explainable alerts (evidence, RPKI status, historical baseline) with evaluation on known incidents.',
    keywords: ['bgp', 'origin as', 'hijack', 'subprefix', 'sub-prefix', 'moas', 'more-specific', 'rpki', 'roa', 'ris live', 'routeviews', 'bgpstream', 'pybgpstream', 'mrt', 'as path', 'explainable', 'alert'],
  },
  {
    id: 'PS-006', domain: 'Cybersecurity',
    title: 'Policy-Constrained Service Failover Demonstrator',
    scope: 'Demonstrate automatic service failover that respects explicit policies (e.g. data residency, security level, cost, allowed regions), with health checking, decision logs and measured failover time.',
    keywords: ['failover', 'fail-over', 'policy', 'health check', 'keepalived', 'vrrp', 'haproxy', 'load balancer', 'opa', 'rego', 'constraint', 'kubernetes', 'rto', 'standby', 'decision log'],
  },
  {
    id: 'PS-008', domain: 'Cybersecurity',
    title: 'Network Management Agent for Reviewed Configuration Changes',
    scope: 'An (optionally AI-assisted) network management agent that proposes configuration changes, produces diffs, requires human review/approval before applying, validates and supports rollback, keeping a full audit trail.',
    keywords: ['netconf', 'configuration', 'config diff', 'diff', 'review', 'approval', 'approve', 'rollback', 'commit confirmed', 'candidate', 'ansible', 'napalm', 'nornir', 'netmiko', 'human-in-the-loop', 'audit', 'agent'],
  },
  {
    id: 'PS-009', domain: 'Cybersecurity',
    title: 'Routing Threat-Intelligence Exchange Prototype',
    scope: 'Prototype exchange of routing-security threat intelligence (hijacks, leaks, malicious prefixes) between parties using a structured format (e.g. STIX/TAXII or a documented JSON schema) with provenance, validation and access control.',
    keywords: ['stix', 'taxii', 'threat intelligence', 'cti', 'misp', 'indicator', 'bgp', 'hijack', 'route leak', 'feed', 'exchange', 'json schema', 'provenance', 'sharing'],
  },
  {
    id: 'PS-011', domain: 'Cybersecurity',
    title: 'Authorised Attack-Surface Inventory and Change Monitor',
    scope: 'Within an explicitly authorised scope, inventory externally visible assets (hosts, ports, services, certificates, subdomains) and detect changes over time, with scope enforcement and change reports.',
    keywords: ['attack surface', 'asset inventory', 'inventory', 'nmap', 'masscan', 'subdomain', 'certificate transparency', 'crt.sh', 'scope', 'authorised', 'authorized', 'change detection', 'diff', 'port scan', 'banner'],
  },
  {
    id: 'PS-012', domain: 'Cybersecurity',
    title: 'Authorised DNS Resolver Exposure Assessment',
    scope: 'Assess DNS resolvers within an authorised scope for exposure risks (open recursion, amplification potential, version disclosure, missing DNSSEC validation, ECS leakage) and produce a risk-ranked report.',
    keywords: ['open resolver', 'recursion', 'recursive', 'amplification', 'dns', 'dig', 'version.bind', 'chaos', 'ecs', 'edns client subnet', 'dnssec validation', 'exposure', 'authorised', 'authorized', 'scope', 'dnspython'],
  },
  {
    id: 'PS-013', domain: 'Cybersecurity',
    title: 'Incident Timeline and Evidence Collection for Small Teams',
    scope: 'A lightweight tool for small teams to collect evidence (logs, files, screenshots) with integrity hashes and chain-of-custody, and build a normalised incident timeline with export for reporting.',
    keywords: ['incident', 'timeline', 'evidence', 'chain of custody', 'forensic', 'sha256', 'hash', 'integrity', 'log', 'plaso', 'sigma', 'case', 'artifact', 'report'],
  },
  {
    id: 'PS-019', domain: 'Cybersecurity',
    title: 'Personal-Data Discovery and Privacy Evidence Inventory',
    scope: 'Discover personal data (e.g. names, phone numbers, Aadhaar/PAN, emails) across files and data stores, classify it, and generate an evidence inventory useful for privacy compliance, with measured precision/recall.',
    keywords: ['pii', 'personal data', 'presidio', 'ner', 'named entity', 'regex', 'aadhaar', 'pan', 'email', 'phone', 'data inventory', 'classification', 'dpdp', 'gdpr', 'scanner', 'precision', 'recall'],
  },
  {
    id: 'PS-022', domain: 'Cybersecurity',
    title: 'eBPF/XDP Rate Limiting for DNS Query Floods in a Lab',
    scope: 'Implement eBPF/XDP-based per-source rate limiting for DNS query floods in a lab, measuring legitimate-query success, drop accuracy, throughput and CPU cost versus a baseline.',
    keywords: ['ebpf', 'xdp', 'bpf', 'libbpf', 'bcc', 'bpftool', 'xdp_drop', 'bpf_map', 'rate limit', 'token bucket', 'dns flood', 'udp', 'port 53', 'dnsperf', 'pktgen', 'clang'],
  },
  {
    id: 'PS-024', domain: 'Cybersecurity',
    title: 'Privacy Pass Token Issuance and Anti-Replay Gateway',
    scope: 'Implement Privacy Pass (RFC 9576/9577/9578) token issuance and redemption with a gateway that verifies tokens and prevents double-spending/replay, with tests for unlinkability assumptions and replay attempts.',
    keywords: ['privacy pass', 'privacypass', 'rfc 9576', 'rfc 9577', 'rfc 9578', 'token issuance', 'redemption', 'blind rsa', 'blind signature', 'voprf', 'oprf', 'issuer', 'attester', 'anti-replay', 'double-spend', 'nonce'],
  },
  {
    id: 'PS-031', domain: 'Cybersecurity',
    title: 'Offline ASPA-Based BGP Export Policy Checker',
    scope: 'Offline tool that uses ASPA (Autonomous System Provider Authorization) objects to verify AS paths and check BGP export policies for route leaks, using MRT dumps or configuration inputs and the ASPA verification algorithm.',
    keywords: ['aspa', 'autonomous system provider authorization', 'as path', 'as_path', 'provider', 'customer', 'upstream', 'downstream', 'route leak', 'valley-free', 'rpki', 'mrt', 'export policy', 'verification'],
  },
  {
    id: 'PS-035', domain: 'Cybersecurity',
    title: 'Evidence-Based Operator Network Fault Localisation',
    scope: 'Localise faults in an operator network by correlating evidence (telemetry, syslog, SNMP, traceroute, topology) and produce ranked, explainable root-cause hypotheses, evaluated on injected faults.',
    keywords: ['fault localisation', 'fault localization', 'root cause', 'rca', 'telemetry', 'syslog', 'snmp', 'traceroute', 'topology', 'correlation', 'evidence', 'fault injection', 'alarm', 'netflow'],
  },
  {
    id: 'PS-036', domain: 'Cybersecurity',
    title: 'PQC DNSSEC MTL Benchmark Using a Reference Implementation',
    scope: 'Benchmark post-quantum DNSSEC using Merkle Tree Ladder (MTL) mode with a reference implementation, comparing signature/response sizes, signing/validation time and fragmentation/TCP fallback against classical algorithms.',
    keywords: ['pqc', 'post-quantum', 'mtl', 'merkle tree ladder', 'slh-dsa', 'sphincs', 'falcon', 'dilithium', 'ml-dsa', 'dnssec', 'signature size', 'benchmark', 'reference implementation', 'liboqs', 'fragmentation'],
  },

  // ---------------- Internet Measurement ----------------
  {
    id: 'PS-010', domain: 'Internet Measurement',
    title: 'Evidence-Based IP Network-Type Classification',
    scope: 'Classify IP addresses/prefixes by network type (residential, mobile, hosting/cloud, enterprise, education, CGNAT) using documented evidence sources (ASN data, rDNS, PeeringDB, WHOIS, measurements) with explanations and accuracy evaluation.',
    keywords: ['ip classification', 'network type', 'asn', 'residential', 'hosting', 'datacenter', 'mobile', 'cgnat', 'rdns', 'reverse dns', 'peeringdb', 'whois', 'rir', 'geolocation', 'evidence', 'classifier'],
  },
  {
    id: 'PS-025', domain: 'Internet Measurement',
    title: 'Browser-Initiated DNS Resolver Measurement Pilot',
    scope: 'A browser-based pilot that, with user consent, triggers DNS lookups of unique names to an authoritative server under the team\'s control to identify the recursive resolvers users actually use (and properties like ECS, DNSSEC, DoH), with privacy safeguards.',
    keywords: ['browser', 'javascript', 'resolver', 'recursive resolver', 'authoritative', 'unique subdomain', 'wildcard', 'ecs', 'doh', 'measurement', 'pilot', 'consent', 'whoami', 'dns'],
  },
  {
    id: 'PS-027', domain: 'Internet Measurement',
    title: 'IPv6 Website and Dependency Readiness Auditor',
    scope: 'Audit websites for IPv6 readiness including all third-party dependencies (CDNs, scripts, APIs, DNS, mail), reporting which resources break on IPv6-only access and producing readiness scores.',
    keywords: ['ipv6', 'aaaa', 'ipv6-only', 'dual-stack', 'readiness', 'dependency', 'third-party', 'cdn', 'crawler', 'headless', 'playwright', 'puppeteer', 'nat64', 'dns64', 'audit'],
  },
  {
    id: 'PS-028', domain: 'Internet Measurement',
    title: 'Happy Eyeballs IPv4/IPv6 Fallback Measurement',
    scope: 'Measure Happy Eyeballs (RFC 8305/6555) behaviour of clients/OSes/browsers under controlled IPv6/IPv4 impairment, quantifying connection-attempt delay, fallback time and protocol preference.',
    keywords: ['happy eyeballs', 'rfc 8305', 'rfc 6555', 'connection attempt delay', 'fallback', 'ipv6', 'ipv4', 'dual-stack', 'tcpdump', 'netem', 'impairment', 'tc qdisc', 'curl'],
  },
  {
    id: 'PS-029', domain: 'Internet Measurement',
    title: 'Application-Oriented Network Quality Evaluation Using QoO',
    scope: 'Evaluate network quality from an application perspective using the Quality of Outcome (QoO) framework: measure latency distributions/loss, map them to application requirements, and report outcome likelihoods.',
    keywords: ['quality of outcome', 'qoo', 'network quality', 'latency distribution', 'responsiveness', 'rpm', 'irtt', 'ippm', 'application requirement', 'packet loss', 'percentile', 'quality attenuation'],
  },
  {
    id: 'PS-030', domain: 'Internet Measurement',
    title: 'Bufferbloat and Queue-Management Evaluation Lab',
    scope: 'Build a lab to reproduce bufferbloat and evaluate AQM schemes (fq_codel, CAKE, PIE) versus FIFO under load, measuring latency under load, throughput and fairness with reproducible scripts (tc/netem, flent).',
    keywords: ['bufferbloat', 'aqm', 'fq_codel', 'codel', 'cake', 'pie', 'pfifo', 'qdisc', 'tc ', 'netem', 'flent', 'rrul', 'latency under load', 'iperf', 'queue'],
  },
  {
    id: 'PS-032', domain: 'Internet Measurement',
    title: 'Path and Reachability Analysis During RPKI State Changes',
    scope: 'Measure how data-plane paths and reachability change when a prefix\'s RPKI/ROV state changes (valid ↔ invalid), using beacons/test prefixes and measurements (RIPE Atlas, traceroute), with analysis of ROV deployment effects.',
    keywords: ['rpki', 'rov', 'roa', 'invalid', 'route origin validation', 'beacon', 'ripe atlas', 'traceroute', 'reachability', 'routinator', 'rpki-client', 'bgp', 'data plane', 'path'],
  },

  // ---------------- Smart Cities ----------------
  {
    id: 'PS-003', domain: 'Smart Cities',
    title: 'Federated Traffic-Flow Prediction with Communication-Cost Evaluation',
    scope: 'Train traffic-flow prediction models with federated learning across simulated clients (e.g. on PeMS / METR-LA), comparing accuracy with centralised training and quantifying communication cost (bytes, rounds, compression).',
    keywords: ['federated', 'federated learning', 'flower', 'flwr', 'fedavg', 'fedprox', 'traffic flow', 'pems', 'metr-la', 'gnn', 'stgcn', 'lstm', 'communication cost', 'rounds', 'bytes transmitted', 'compression'],
  },
  {
    id: 'PS-014', domain: 'Smart Cities',
    title: 'Pilot Internet-Quality Comparison by Verified Access Medium',
    scope: 'Pilot measurement of Internet quality (throughput, latency, loss) grouped by a verified access medium (fibre, cable, DSL, 4G/5G, Wi-Fi/FWA) with a documented verification method and statistically sound comparison.',
    keywords: ['access medium', 'fibre', 'fiber', 'ftth', 'dsl', 'cable', '4g', '5g', 'lte', 'fwa', 'speed test', 'speedtest', 'ndt', 'm-lab', 'throughput', 'verification', 'pilot'],
  },
  {
    id: 'PS-015', domain: 'Smart Cities',
    title: 'Explainable Home and Last-Mile Connectivity Diagnosis',
    scope: 'Diagnose home and last-mile connectivity problems (Wi-Fi, router, ISP link, DNS, upstream) from measurements and give explainable, user-understandable diagnoses with recommended actions, evaluated on injected faults.',
    keywords: ['wifi', 'wi-fi', 'rssi', 'router', 'gateway', 'last mile', 'last-mile', 'diagnosis', 'diagnostic', 'explainable', 'ping', 'traceroute', 'dns', 'speed test', 'home network', 'troubleshoot'],
  },
];

export const psById = (id) => PROBLEM_STATEMENTS.find((p) => p.id === id) || null;

// Weighted evaluation rubric (weights sum to 100). Each criterion is scored 0–10.
export const RUBRIC = [
  { key: 'alignment', label: 'Problem Statement Alignment', weight: 20,
    desc: 'Does the implementation address the core objective of the selected problem statement, not a generic or adjacent problem?' },
  { key: 'technical', label: 'Technical Depth & Correctness', weight: 20,
    desc: 'Soundness of the approach, correct use of protocols/standards/algorithms, non-trivial engineering.' },
  { key: 'completeness', label: 'Implementation Completeness', weight: 15,
    desc: 'How much of the claimed system is actually implemented and runnable versus stubbed, mocked or only described.' },
  { key: 'evaluation', label: 'Experimental Rigour & Evaluation', weight: 15,
    desc: 'Presence of experiments, measurements or simulations with baselines, metrics, datasets and reported results.' },
  { key: 'quality', label: 'Code Quality & Engineering', weight: 10,
    desc: 'Structure, modularity, readability, error handling, tests, configuration management.' },
  { key: 'docs', label: 'Documentation & Reproducibility', weight: 10,
    desc: 'README clarity, setup and run instructions, dependency pinning, scripts to reproduce results.' },
  { key: 'innovation', label: 'Innovation & Research Contribution', weight: 5,
    desc: 'Novelty beyond tutorials or boilerplate; insight that would interest a research/standards audience.' },
  { key: 'ethics', label: 'Security, Ethics & Lab Safety', weight: 5,
    desc: 'Respect for authorisation, lab-only/controlled constraints, privacy safeguards, no leaked secrets.' },
];

export function gradeFor(score) {
  if (score == null || isNaN(score)) return '—';
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'E';
}
