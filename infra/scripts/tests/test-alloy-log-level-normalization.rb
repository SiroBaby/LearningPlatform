#!/usr/bin/env ruby
# frozen_string_literal: true

values = File.read(File.expand_path('../../observability/alloy-values.yml', __dir__))

required_rules = {
  'info' => '(?i:log|info)',
  'warn' => '(?i:warn|warning)',
  'error' => '(?i:err|error|fatal|critical)',
  'debug' => '(?i:debug)',
  'trace' => '(?i:trace)'
}.freeze

abort 'Alloy must parse CRI records before normalizing JSON log levels.' unless values.include?('stage.cri {}')

required_rules.each do |normalized, source_levels|
  rule = /stage\.replace\s*\{\s+expression\s*=.*#{Regexp.escape(source_levels)}.*\s+replace\s*=.*#{Regexp.escape(normalized)}.*\s+\}/m
  abort "Alloy must normalize #{source_levels} to #{normalized}." unless values.match?(rule)
end

abort 'Alloy must not promote log level to a Loki label.' if values.match?(/stage\.labels\s*\{[^}]*\blevel\b/m)

puts 'PASS Alloy normalizes recognized JSON levels without adding labels.'
