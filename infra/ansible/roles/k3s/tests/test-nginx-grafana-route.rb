#!/usr/bin/env ruby
# frozen_string_literal: true

require 'open3'
require 'tmpdir'

ROOT = File.expand_path('../../../..', __dir__)
PUBLIC_HOST = 'grafana.sirobabycloud.io.vn'

def assert(condition, message)
  abort "FAIL #{message}" unless condition
end

Dir.mktmpdir('learning-platform-nginx') do |directory|
  rendered_path = File.join(directory, 'nginx.conf')
  command = [
    'ansible', 'localhost', '-i', 'localhost,', '-c', 'local', '-m', 'ansible.builtin.template',
    '-e', "@#{File.join(ROOT, 'ansible/vars/dev.yml')}",
    '-a', "src=#{File.join(ROOT, 'ansible/roles/k3s/templates/nginx-learning-platform.conf.j2')} dest=#{rendered_path} mode=0600"
  ]
  output, status = Open3.capture2e({ 'ANSIBLE_CONFIG' => File.join(ROOT, 'ansible.cfg') }, *command)
  assert(status.success?, "Nginx template did not render: #{output}")

  blocks = File.read(rendered_path).scan(/server\s*\{.*?^\}/m)
  grafana_blocks = blocks.select { |block| block.match?(/^\s*server_name #{Regexp.escape(PUBLIC_HOST)};$/) }
  assert(grafana_blocks.length == 2, 'managed Nginx must own the public Grafana host on exactly port 80 and 443')

  http, https = grafana_blocks.partition { |block| block.match?(/^\s*listen 80;$/) }
  assert(http.length == 1 && http.first.include?('return 301 https://$host$request_uri;'), 'Grafana HTTP route must redirect to HTTPS')
  assert(https.length == 1 && https.first.match?(/^\s*listen 443 ssl;$/), 'Grafana HTTPS route must be present')

  route = https.first
  %w[
    proxy_pass\ http://127.0.0.1:32080;
    proxy_set_header\ Host\ \$host;
    proxy_set_header\ X-Forwarded-For\ \$proxy_add_x_forwarded_for;
    proxy_set_header\ X-Forwarded-Host\ \$host;
    proxy_set_header\ X-Forwarded-Proto\ https;
    proxy_set_header\ X-Forwarded-Port\ 443;
  ].each do |contract|
    assert(route.match?(/^\s*#{contract}$/), "Grafana HTTPS route must preserve #{contract}")
  end
end

puts 'PASS rendered Nginx owns the public Grafana host and preserves proxy headers'
