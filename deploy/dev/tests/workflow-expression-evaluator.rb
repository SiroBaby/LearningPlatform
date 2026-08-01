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

def workflow_job_runs?(jobs, job_name, context)
  job = jobs.fetch(job_name)
  needs = job.fetch('needs', [])
  needs = [needs] if needs.is_a?(String)
  expression = job.fetch('if', '')
  needs_successful = needs.all? { |need| context.fetch('needs').fetch(need).fetch('result') == 'success' }

  (expression.include?('always()') || needs_successful) && WorkflowExpressionEvaluator.new(expression, context).evaluate
end
