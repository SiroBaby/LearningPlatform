#!/usr/bin/env ruby
# frozen_string_literal: true

require 'yaml'

def require_condition(condition, message)
  abort message unless condition
end

template_path = File.expand_path('../../ansible/roles/observability/templates/alertmanager-external-secret.yaml.j2', __dir__)
template = File.read(template_path)
config_match = template.match(/^        alertmanager\.yaml: \|\n(?<config>.*?)(?=^  data:)/m)
require_condition(config_match, 'Alertmanager ExternalSecret must contain an alertmanager.yaml configuration block.')

raw_config = config_match[:config].lines.map { |line| line.sub(/\A {10}/, '') }.join
bot_token_lines = raw_config.lines.grep(/^\s*-\s*bot_token:/)
chat_id_lines = raw_config.lines.grep(/^\s*chat_id:/)
require_condition(
  bot_token_lines == ["      - bot_token: '{{ '{{ .telegram_bot_token }}' }}'\n"],
  'Alertmanager must keep the Telegram bot token as an ESO template placeholder.'
)
require_condition(
  chat_id_lines == ["        chat_id: {{ '{{ .telegram_chat_id }}' }}\n"],
  'Alertmanager must keep the Telegram chat ID as an ESO template placeholder.'
)
require_condition(bot_token_lines.length == 1, 'Alertmanager must define exactly one bot token field.')
require_condition(chat_id_lines.length == 1, 'Alertmanager must define exactly one chat ID field.')

sanitized_config = raw_config.lines.map do |line|
  case line
  when /^\s*-\s*bot_token:/
    "      - bot_token: TOKEN_TEMPLATE\n"
  when /^\s*chat_id:/
    "        chat_id: 123\n"
  else
    line
  end
end.join
config = YAML.safe_load(sanitized_config)
route = config.fetch('route')
routes = route.fetch('routes')

require_condition(route.fetch('receiver') == 'telegram', 'Alertmanager default route must preserve the Telegram receiver.')
require_condition(route.fetch('group_by') == %w[alertname namespace severity], 'Alertmanager grouping labels must remain bounded and severity-aware.')
require_condition(route.fetch('group_wait') == '30s', 'Alertmanager actionable alerts must retain a short group wait.')
require_condition(route.fetch('group_interval') == '5m', 'Alertmanager actionable alerts must retain a bounded group interval.')
require_condition(route.fetch('repeat_interval') == '4h', 'Alertmanager actionable alerts must retain a bounded repeat interval.')
require_condition(routes.length == 2, 'Alertmanager must define only the control-alert and info-digest child routes.')

control_route = routes.fetch(0)
info_route = routes.fetch(1)
require_condition(
  control_route == {
    'matchers' => ['alertname=~"^(InfoInhibitor|Watchdog)$"'],
    'receiver' => 'null'
  },
  'InfoInhibitor and Watchdog must be null-routed by the first child route.'
)
require_condition(
  info_route == {
    'matchers' => ['severity="info"'],
    'receiver' => 'telegram',
    'group_wait' => '5m',
    'group_interval' => '30m',
    'repeat_interval' => '24h'
  },
  'Info alerts must use the existing Telegram receiver as a low-frequency digest.'
)

receivers = config.fetch('receivers')
require_condition(receivers.map { |receiver| receiver.fetch('name') } == %w[null telegram], 'Alertmanager must preserve Telegram and add one null receiver.')
require_condition(receivers.fetch(0) == { 'name' => 'null' }, 'The null Alertmanager receiver must not contain notification configuration.')

inhibit_rules = config.fetch('inhibit_rules')
require_condition(inhibit_rules.length == 1, 'Alertmanager must define exactly one severity inhibition rule.')
require_condition(
  inhibit_rules.fetch(0) == {
    'source_matchers' => ['severity=~"warning|critical"'],
    'target_matchers' => ['severity="info"'],
    'equal' => %w[namespace cluster]
  },
  'Warning and critical alerts must inhibit only matching info alerts by namespace and cluster.'
)

puts 'PASS Alertmanager routes control alerts to null, digests info, and preserves secret placeholders.'
