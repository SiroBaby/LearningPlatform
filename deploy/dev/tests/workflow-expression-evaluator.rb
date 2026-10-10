# frozen_string_literal: true

class WorkflowExpressionEvaluator
  TOKEN_PATTERN = /\s*(always\(\)|&&|\|\||==|\(|\)|'[^']*'|[A-Za-z_][A-Za-z0-9_.-]*)/

  def initialize(expression, context)
    @tokens = expression.scan(TOKEN_PATTERN).flatten
    @context = context
    @position = 0
  end

  def evaluate
    result = parse_or
    raise "unexpected token #{current_token.inspect}" if current_token

    result
  end

  private

  def parse_or
    result = parse_and
    while consume('||')
      right = parse_and
      result = result || right
    end
    result
  end

  def parse_and
    result = parse_term
    while consume('&&')
      right = parse_term
      result = result && right
    end
    result
  end

  def parse_term
    return parse_parenthesized if consume('(')
    return true if consume('always()')

    left = resolve(advance)
    return left unless consume('==')

    left == resolve(advance)
  end

  def parse_parenthesized
    result = parse_or
    raise 'missing closing parenthesis' unless consume(')')

    result
  end

  def resolve(token)
    return token.delete_prefix("'").delete_suffix("'") if token.start_with?("'")

    token.split('.').reduce(@context) { |value, key| value.fetch(key) }
  end

  def consume(token)
    return false unless current_token == token

    @position += 1
    true
  end

  def advance
    token = current_token
    raise 'unexpected end of expression' unless token

    @position += 1
    token
  end

  def current_token
    @tokens[@position]
  end
end

def workflow_job_needs(jobs, job_name)
  needs = jobs.fetch(job_name).fetch('needs', [])
  needs.is_a?(String) ? [needs] : needs
end

def workflow_job_ancestors(jobs, job_name)
  workflow_job_needs(jobs, job_name).flat_map { |need| [need] + workflow_job_ancestors(jobs, need) }.uniq
end

# Without a status function, GitHub applies an implicit success() to every
# transitive ancestor, not only to direct needs: one skipped quality job skips
# all downstream jobs that omit always(). Context must list every ancestor.
def workflow_job_runs?(jobs, job_name, context)
  expression = jobs.fetch(job_name).fetch('if', '')
  status_allowed = expression.include?('always()') || workflow_job_ancestors(jobs, job_name).all? do |ancestor|
    context.fetch('needs').fetch(ancestor).fetch('result') == 'success'
  end

  status_allowed && WorkflowExpressionEvaluator.new(expression, context).evaluate
end
