# :nodoc:
Dir["#{File.expand_path(File.dirname(__FILE__))}/**/*.rb"].each{|f| require f}

STDOUT.sync = true
STDERR.sync = true

# :nodoc:
include Architect::DSL
